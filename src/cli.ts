#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { applyFill } from './build/apply.js';
import { findDrift } from './build/drift.js';
import { GENERATED_FILE, generatedStatus, loadGenerated } from './build/generated.js';
import { BuildError, suggestIndex } from './build/index-suggest.js';
import { planFill } from './build/plan.js';
import { previewFill } from './build/preview.js';
import { diffScans } from './diff.js';
import { ClaudeNotFound } from './eval/claude.js';
import { DraftError, draftProbes } from './eval/draft.js';
import { EvalError, runEval } from './eval/eval.js';
import { ProbeError } from './eval/probes.js';
import { loadRegistry, type Registry, RegistryError } from './registry/registry.js';
import { gitIgnored } from './repo/gitignore.js';
import { fsReader, gitReader, gitTopLevel, RefNotFound } from './repo/reader.js';
import { renderBuild } from './report/build.js';
import { renderEval } from './report/eval.js';
import { renderDiffMarkdown, renderErrorMarkdown } from './report/markdown.js';
import { renderDiff, renderScan } from './report/render.js';
import { scanRepo } from './scan.js';

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

class UsageError extends Error {}

const isDirectory = (dir: string) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('expected a whole number of at least 1');
  return n;
}

const workdirOf = (flag: string | undefined) => resolve(flag ?? process.env.RUNNER_TEMP ?? tmpdir());
// The user's own cache folder: in a temp folder that other users share, they could plant results.
const cacheOf = (flag: string | undefined) =>
  resolve(flag ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), process.platform === 'win32' ? 'AppData/Local' : '.cache'), 'ctxlock'));
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
// A path is resolved here, since Claude Code runs with the copy as its working directory.
const claudeOf = (flag: string | undefined) => (flag === undefined ? ['claude'] : [/[\\/]/.test(flag) ? resolve(flag) : flag]);

// C0 and C1 control characters, built from code points so no raw one sits in the source.
const cp = String.fromCodePoint;
const CONTROLS = new RegExp(`[${cp(0)}-${cp(31)}${cp(127)}-${cp(159)}]`, 'g');

interface EvalFlags {
  base: string;
  head?: string;
  format: 'text' | 'json' | 'markdown';
  runs?: number;
  maxRuns?: number;
  maxMinutes?: number;
  model?: string;
  claude?: string;
  workdir?: string;
  cache?: string;
  all?: boolean;
  keepRuns?: boolean;
  failOnRegression?: boolean;
}

export async function main(argv: string[], io: Io): Promise<number> {
  let code = 0;
  // Set once diff knows it is writing a pull request comment, so a failure is written as one too.
  let markdown = false;
  const program = new Command('ctxlock')
    .description('CI, a dependency graph and a feedback loop for AI agent context')
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  const views = {
    scan: 'list context units and what each agent loads',
    lint: 'check context against agent limits and known pitfalls; exits 1 on a must finding',
    budget: 'show how much of each agent limit is used, per site',
  } as const;
  for (const [view, description] of Object.entries(views) as Array<[keyof typeof views, string]>) {
    program
      .command(`${view} [dir]`)
      .description(description)
      .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
      .option('--agnix', 'also run agnix through npx (downloads it on first use)')
      .action(async (dir: string | undefined, opts: { format: 'text' | 'json'; agnix?: boolean }) => {
        const root = resolve(dir ?? '.');
        if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
        const result = await scanRepo(fsReader(root), { agnix: opts.agnix ?? false });
        io.stdout(renderScan(result, view, opts.format));
        if (view === 'lint' && result.findings.some((f) => f.severity === 'must')) code = 1;
      });
  }

  program
    .command('build [dir]')
    .description("report what each agent loads, the gaps between them and drift; --fill-missing writes what is missing, never over a person's file")
    .option('--fill-missing', 'write the missing targets, and record them in .ctxlock/generated.json')
    .option('--suggest-index <dir>', 'print a compressed index of the markdown under <dir> for AGENTS.md; nothing is written')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .action(async (dir: string | undefined, opts: { fillMissing?: boolean; suggestIndex?: string; format: 'text' | 'json' }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      // Personal, gitignored files never decide what gets committed.
      const reader = fsReader(root, { local: false });
      if (opts.suggestIndex !== undefined) {
        const { text, bytes } = await suggestIndex(reader, opts.suggestIndex);
        io.stdout(`${text}\n\n${bytes} bytes. Not written. Measure it with a probe before you commit it: see the-guide/build.md.\n`);
        return;
      }
      const scan = await scanRepo(reader);
      // An unreadable record reads as no files, so a fill would replace it and lose its entries.
      if (opts.fillMissing && scan.generated.error !== null) {
        throw new BuildError(`${GENERATED_FILE} is not valid: ${scan.generated.error}; fix it first: --fill-missing would replace it`);
      }
      const top = await gitTopLevel(root);
      // Outside git, nothing is ignored.
      const ignored = top ? (paths: string[]) => gitIgnored(top, paths) : async () => new Set<string>();
      const { plan, after } = await previewFill(reader, await planFill(scan, reader, ignored), scan);
      const { written, removed, refused } = opts.fillMissing ? await applyFill(top ?? root, plan, scan.generated.files) : { written: [], removed: [], refused: [] };
      // A fill changes the files and the record, so both are read again.
      const now = opts.fillMissing ? fsReader(root, { local: false }) : reader;
      const recorded = opts.fillMissing ? (await loadGenerated(now)).files : scan.generated.files;
      io.stdout(
        renderBuild(
          {
            root,
            budget: scan.budget,
            after: plan.actions.length > 0 ? after.budget : null,
            gaps: plan.gaps,
            drift: findDrift(scan),
            generated: await generatedStatus(now, recorded),
            written,
            removed,
            refused,
            filled: opts.fillMissing ?? false,
          },
          opts.format,
        ),
      );
    });

  program
    .command('diff [dir]')
    .description('compare context between two git refs, or a ref and the working tree; exits 1 on a new must finding')
    .requiredOption('--base <ref>', 'the ref to compare against, such as origin/main')
    .option('--head <ref>', 'the ref to check (default: the working tree)')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
    .action(async (dir: string | undefined, opts: { base: string; head?: string; format: 'text' | 'json' | 'markdown' }) => {
      markdown = opts.format === 'markdown';
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      if ((await gitTopLevel(root)) === null) throw new UsageError(`ctxlock diff: ${dir ?? '.'} is not inside a git repository`);
      const at = async (ref: string, which: string, hint = '') => {
        try {
          return await gitReader(root, ref);
        } catch (err) {
          if (err instanceof RefNotFound) throw new UsageError(`${which} ref ${ref} not found${hint}`);
          throw err;
        }
      };
      const base = await scanRepo(await at(opts.base, 'base', ' — in GitHub Actions use actions/checkout with fetch-depth: 0'));
      const head = await scanRepo(opts.head ? await at(opts.head, 'head') : fsReader(root), { settings: base.registry });
      const result = diffScans(base, head);
      io.stdout(opts.format === 'markdown' ? renderDiffMarkdown(result) : renderDiff(result, opts.format));
      if ([...result.newFindings, ...result.execChanges].some((f) => f.severity === 'must')) code = 1;
    });

  program
    .command('eval [dir]')
    .description('run probes against Claude Code with the base and the head context; advisory unless --fail-on-regression')
    .requiredOption('--base <ref>', 'the ref to compare against, such as origin/main')
    .option('--head <ref>', 'the ref to check (default: the working tree)')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
    .option('--runs <n>', 'runs per arm (default: eval.runs in ctxlock.yaml, or 3)', count)
    .option('--max-runs <n>', 'the most runs this check may start (default: eval.max-runs, or 24)', count)
    .option('--max-minutes <n>', 'start no run after this many minutes (default: eval.max-minutes, or 20)', count)
    .option('--model <model>', 'the model Claude Code runs (default: eval.model, or sonnet)')
    .option('--claude <path>', "Claude Code's executable (default: claude on PATH)")
    .option('--workdir <dir>', 'where run folders and the cache go (default: $RUNNER_TEMP, or the system temp folder)')
    .option('--cache <dir>', 'where results from git refs are cached (default: ctxlock under $XDG_CACHE_HOME, else ~/.cache, or ~/AppData/Local on Windows)')
    .option('--all', 'run every probe, not only those on changed units')
    .option('--keep-runs', 'keep the run folders, with what the agent tried, for debugging')
    .option('--fail-on-regression', 'exit 1 when a probe from the base passes every base run and no head run')
    .action(async (dir: string | undefined, opts: EvalFlags) => {
      markdown = opts.format === 'markdown';
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      if ((await gitTopLevel(root)) === null) throw new UsageError(`ctxlock eval: ${dir ?? '.'} is not inside a git repository`);
      let settings: Registry['eval'];
      try {
        // The base's settings, like diff's (D30): a pull request cannot shrink the check that judges it.
        settings = (await loadRegistry(await gitReader(root, opts.base))).eval;
      } catch (err) {
        if (err instanceof RefNotFound) throw new UsageError(`base ref ${opts.base} not found — in GitHub Actions use actions/checkout with fetch-depth: 0`);
        throw err;
      }
      const workdir = workdirOf(opts.workdir);
      const claude = claudeOf(opts.claude);
      const result = await runEval({
        root,
        base: opts.base,
        head: opts.head,
        runs: opts.runs ?? settings.runs,
        maxRuns: opts.maxRuns ?? settings.maxRuns,
        maxMinutes: opts.maxMinutes ?? settings.maxMinutes,
        model: opts.model ?? settings.model,
        claude,
        workdir,
        cacheDir: cacheOf(opts.cache),
        ctxlockVersion: VERSION,
        all: opts.all ?? false,
        keepRuns: opts.keepRuns ?? false,
      });
      io.stdout(renderEval(result, opts.format));
      if (opts.keepRuns) io.stderr(`ctxlock: run folders kept in ${workdir}\n`);
      if (opts.failOnRegression && result.gateFailures.length > 0) code = 1;
    });

  program
    .command('probe')
    .description('work with the probe files under evals/probes')
    .command('draft [dir]')
    .description('draft probes for a unit with Claude, and write the ones that tell a copy with the unit from one without it to a new file')
    .requiredOption('--unit <id>', 'the unit to draft probes for, as ctxlock scan lists it')
    .option('--count <n>', 'how many candidates to ask for', count, 4)
    .option('--runs <n>', 'runs per arm when checking each candidate', count, 2)
    .option('--max-runs <n>', 'the most runs the checking may start', count, 24)
    .option('--model <model>', 'the model Claude Code runs (default: eval.model, or sonnet)')
    .option('--claude <path>', "Claude Code's executable (default: claude on PATH)")
    .option('--workdir <dir>', 'where run folders go (default: $RUNNER_TEMP, or the system temp folder)')
    .option('--out <path>', 'the file to write, relative to the repository (default: evals/probes/<unit>.yaml)')
    .action(async (dir: string | undefined, opts: { unit: string; count: number; runs: number; maxRuns: number; model?: string; claude?: string; workdir?: string; out?: string }) => {
      const given = resolve(dir ?? '.');
      if (!isDirectory(given)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const root = (await gitTopLevel(given)) ?? given;
      const settings = (await loadRegistry(fsReader(root))).eval;
      const r = await draftProbes({
        root,
        unit: opts.unit,
        count: opts.count,
        runs: opts.runs,
        maxRuns: opts.maxRuns,
        model: opts.model ?? settings.model,
        claude: claudeOf(opts.claude),
        workdir: workdirOf(opts.workdir),
        out: opts.out,
      });
      const lines = [`ctxlock probe draft · ${opts.unit}`];
      lines.push(r.kept.length > 0 ? `Wrote ${r.path}: ${r.kept.length} kept. Review it before committing.` : 'No probe told the two copies apart, so nothing was written.');
      // Ids and reasons carry the model's text, and a control character in it could drive the terminal.
      const printable = (s: string) => s.replace(CONTROLS, '?');
      for (const id of r.kept) lines.push(`  kept       ${printable(id)}`);
      for (const d of r.discarded) lines.push(`  discarded  ${printable(d.id)}: ${printable(d.reason)}`);
      lines.push(`Runs: ${r.runs}`);
      io.stdout(`${lines.join('\n')}\n`);
    });

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    // Commander has already printed its own message; help and version exit 0.
    if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : 2;
    // Anything else is a bug or input ctxlock cannot handle. It still exits 2, because 1 means must-fix.
    const known = [UsageError, RegistryError, RefNotFound, EvalError, ProbeError, ClaudeNotFound, DraftError, BuildError].some((type) => err instanceof type);
    const reason = err instanceof Error ? err.message : String(err);
    io.stderr(known ? `${reason}\n` : `ctxlock could not run: ${reason}\n`);
    if (markdown) io.stdout(renderErrorMarkdown(reason));
    return 2;
  }
  return code;
}

// Run when executed as the ctxlock binary (including through an npm bin symlink), not when imported.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) });
}
