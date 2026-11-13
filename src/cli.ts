#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { applyFill } from './build/apply.js';
import { findDrift } from './build/drift.js';
import { GENERATED_FILE, generatedStatus } from './build/generated.js';
import { BuildError, suggestIndex } from './build/index-suggest.js';
import { eventsHome, readEvents } from './collect/events.js';
import { buildReport, shareable } from './collect/report.js';
import { joinSessions, sessionTimelines } from './collect/sessions.js';
import { DiagnosisError } from './loop/diagnose.js';
import { FixesError, shippedFixes } from './loop/fixes.js';
import { githubRepo, IssueError, openIssue } from './loop/issue.js';
import { counters, numbers, outcomeOf } from './loop/outcomes.js';
import { type DraftKind, draftName, draftState, renderDraft } from './loop/draft.js';
import { findMisses, type Misses } from './loop/misses.js';
import { diagnose } from './loop/propose.js';
import { renderDiagnosis, renderProposal } from './report/diagnose.js';
import { renderOutcomes } from './report/outcomes.js';
import { findTranscript, readTranscript, type SessionTranscript, transcriptsHome } from './loop/transcript.js';
import { renderMisses } from './report/misses.js';
import { buildGraph, impactOf, pinnedBy, resolveRef, whoUses } from './graph/graph.js';
import { renderImpact, renderWhoUses } from './report/graph.js';
import { renderLoads } from './report/loads.js';
import { planFill } from './build/plan.js';
import { previewFill } from './build/preview.js';
import { diffScans } from './diff.js';
import { ClaudeNotFound } from './eval/claude.js';
import { DraftError, draftProbes } from './eval/draft.js';
import { EvalError, runEval } from './eval/eval.js';
import { ProbeError } from './eval/probes.js';
import { loadRegistry, type Registry, RegistryError, type Upstream } from './registry/registry.js';
import { gitIgnored } from './repo/gitignore.js';
import { fsReader, gitOrigin, gitReader, gitTopLevel, RefNotFound } from './repo/reader.js';
import { renderBuild } from './report/build.js';
import { renderEval } from './report/eval.js';
import { renderDiffMarkdown, renderErrorMarkdown } from './report/markdown.js';
import { printable, renderDiff, renderScan } from './report/render.js';
import { renderSync } from './report/sync.js';
import { type ScanResult, scanRepo } from './scan.js';
import { UpstreamError, fetchUpstream } from './sync/fetch.js';
import { LOCK_FILE, LockError, loadLock } from './sync/lock.js';
import { applySync, planSync } from './sync/sync.js';

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

class UsageError extends Error {}

// The scans of a base ref and a head, which is a ref or the working tree, as diff and impact compare
// them. The head is checked with the base's lint settings, so a change cannot quiet its own findings.
async function scansAt(root: string, opts: { base: string; head?: string }) {
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
  return { base, head };
}

const isDirectory = (dir: string) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
// A path with links and 8.3 short names expanded, or as it is when nothing is there any more.
const real = (path: string) => (existsSync(path) ? realpathSync.native(path) : path);

// Every ctxlock.lock in a folder and the folders below it, as they are on disk; no link is followed.
function locksUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === '.git' || e.name === 'node_modules' ? [] : locksUnder(join(dir, e.name));
    return e.isFile() && e.name === LOCK_FILE ? [join(dir, e.name)] : [];
  });
}

// The locks under the folders given to --locks, each named by its repository's origin or its folder.
async function locksAt(folders: string[], warn: (text: string) => void) {
  const missing = folders.find((p) => !isDirectory(resolve(p)));
  if (missing !== undefined) throw new UsageError(`ctxlock: ${missing} is not a directory`);
  const locks = [];
  for (const path of folders.flatMap((p) => locksUnder(real(resolve(p))))) {
    try {
      const lock = await loadLock({ exists: async () => true, readFile: async () => readFileSync(path) });
      locks.push({ repo: (await gitOrigin(dirname(path))) ?? dirname(path), path, lock });
    } catch (err) {
      // One unreadable lock among many repositories does not hide the others.
      if (!(err instanceof LockError)) throw err;
      warn(`ctxlock: skipped ${path}: ${err.message}\n`);
    }
  }
  return locks;
}

// Recorded sessions in a folder, matched under its real path and under the path as typed: Claude Code
// reports the path its session was started in, and Windows can give a temp folder an 8.3 name.
function recordedAt(root: string) {
  const known = new Map<string, string>();
  const realOf = (path: string) => {
    if (!known.has(path)) known.set(path, real(path));
    return known.get(path)!;
  };
  return { read: readEvents(eventsHome()), roots: [...new Set([real(root), root])], real: realOf };
}

// The recorded sessions here, read against Claude Code's transcripts.
async function missesAt(root: string, scan: ScanResult, opts: { minSessions: number; since?: string }): Promise<Misses> {
  const r = recordedAt(root);
  const timelines = sessionTimelines(r.read, scan, r.roots, r.real);
  const home = transcriptsHome();
  const transcripts = new Map<string, SessionTranscript>();
  for (const { session } of timelines) {
    const file = findTranscript(home, session);
    if (file) transcripts.set(session, await readTranscript(file, session));
  }
  return findMisses(timelines, transcripts, scan, { minSessions: opts.minSessions, ...(opts.since !== undefined && { since: opts.since }) });
}

// This repository, as a draft may name it: its origin, or its folder.
async function repoName(root: string): Promise<string> {
  const top = await gitTopLevel(root);
  return (top ? await gitOrigin(top) : null) ?? basename(real(top ?? root));
}

// Each file into the drafts folder, unless one there was edited since ctxlock wrote it or is someone's own.
function writeDrafts(folder: string, drafts: Array<{ name: string; id: string; kind: DraftKind; text: string }>, title: string): string {
  mkdirSync(folder, { recursive: true });
  const written: string[] = [];
  const left = { edited: [] as string[], other: [] as string[] };
  for (const d of drafts) {
    const file = join(folder, d.name);
    const state = existsSync(file) ? draftState(readFileSync(file, 'utf8'), d.id, d.kind) : 'unedited';
    if (state !== 'unedited') {
      left[state].push(file);
      continue;
    }
    writeFileSync(file, d.text);
    written.push(file);
  }
  const list = (heading: string, files: string[]) => (files.length ? ['', `${heading}:`, ...files.map((f) => `  ${f}`)] : []);
  return `${[...list(title, written), ...list('Left as it is, edited since ctxlock wrote it', left.edited), ...list('Left as it is, not a ctxlock draft', left.other)].join('\n')}\n`;
}

function sessionsAt(root: string, scan: ScanResult) {
  const r = recordedAt(root);
  return joinSessions(r.read, scan, r.roots, r.real);
}

function day(value: string): string {
  const at = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value) throw new InvalidArgumentError('expected a date as YYYY-MM-DD');
  return value;
}

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('expected a whole number of at least 1');
  return n;
}

// eval's status needs 2 valid runs on each side, so one run a side could only ever be inconclusive.
function replayRuns(value: string): number {
  const n = count(value);
  if (n < 2) throw new InvalidArgumentError('expected at least 2, since a replay needs 2 valid runs a side to validate a fix');
  return n;
}

const workdirOf = (flag: string | undefined) => resolve(flag ?? process.env.RUNNER_TEMP ?? tmpdir());
// The user's own cache folder: in a temp folder that other users share, they could plant results.
const cacheOf = (flag: string | undefined) =>
  resolve(flag ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), process.platform === 'win32' ? 'AppData/Local' : '.cache'), 'ctxlock'));
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
// A path is resolved here, since Claude Code runs with the copy as its working directory.
const claudeOf = (flag: string | undefined) => (flag === undefined ? ['claude'] : [/[\\/]/.test(flag) ? resolve(flag) : flag]);


interface DiagnoseFlags {
  format: 'text' | 'json';
  since?: string;
  runs: number;
  maxRuns: number;
  maxMinutes: number;
  model?: string;
  claude?: string;
  workdir?: string;
  drafts?: string;
  open?: boolean;
  gh?: string;
}

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
      const top = await gitTopLevel(root);
      if (opts.suggestIndex !== undefined) {
        // The folder is given from the directory build runs on, and read from the repository's top. Git
        // gives the top by its real path; the directory may come by a symlink or an 8.3 short name, as
        // the temp folder does on GitHub's Windows runners, which realpathSync.native expands.
        const base = real(root);
        const folder = relative(top ?? base, real(resolve(base, opts.suggestIndex))).split(sep).join('/');
        if (folder === '..' || folder.startsWith('../') || isAbsolute(folder)) throw new BuildError(`${opts.suggestIndex} is outside the repository`);
        const { text, bytes } = await suggestIndex(reader, folder);
        io.stdout(`${text}\n\n${bytes} bytes. Not written. Measure it with a probe before you commit it: see the-guide/build.md.\n`);
        return;
      }
      const scan = await scanRepo(reader);
      // An unreadable record reads as no files, so a fill would replace it and lose its entries.
      if (opts.fillMissing && scan.generated.error !== null) {
        throw new BuildError(`${GENERATED_FILE} is not valid: ${scan.generated.error}; fix it first: --fill-missing would replace it`);
      }
      // Outside git, nothing is ignored.
      const ignored = top ? (paths: string[]) => gitIgnored(top, paths) : async () => new Set<string>();
      const { plan, after } = await previewFill(reader, await planFill(scan, reader, ignored), scan);
      const { written, removed, refused } = opts.fillMissing ? await applyFill(top ?? root, plan, scan.generated.files) : { written: [], removed: [], refused: [] };
      // A fill changes the files and the record, so both are read again.
      const now = opts.fillMissing ? fsReader(root, { local: false }) : reader;
      const final = opts.fillMissing ? await scanRepo(now) : scan;
      io.stdout(
        renderBuild(
          {
            root,
            budget: final.budget,
            after: plan.actions.length > 0 ? after.budget : null,
            gaps: plan.gaps,
            drift: findDrift(scan),
            generated: await generatedStatus(now, final.generated.files),
            generatedError: scan.generated.error,
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
    .command('sync [dir]')
    .description("bring in the skills and rules ctxlock.yaml names from each upstream, pinned in ctxlock.lock; exits 1, writing nothing, rather than overwrite a person's file or an edited one")
    .option('--dry-run', 'show what would change; nothing is written')
    .option('--cache <dir>', 'where upstream clones are kept (default: ctxlock under $XDG_CACHE_HOME, else ~/.cache, or ~/AppData/Local on Windows)')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
    .action(async (dir: string | undefined, opts: { dryRun?: boolean; cache?: string; format: 'text' | 'json' | 'markdown' }) => {
      markdown = opts.format === 'markdown';
      const given = resolve(dir ?? '.');
      if (!isDirectory(given)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const top = await gitTopLevel(given);
      if (!top) throw new UsageError(`ctxlock: ${given} is not in a git repository`);
      const reader = fsReader(top, { local: false });
      const scan = await scanRepo(reader);
      const cache = cacheOf(opts.cache);
      // A repository given as ./ or ../ is a folder beside this one, wherever sync runs from.
      const read = (u: Upstream) => fetchUpstream({ ...u, repo: /^\.\.?([\\/]|$)/.test(u.repo) ? resolve(top, u.repo) : u.repo }, cache);
      const disk = { exists: async (path: string) => existsSync(join(top, path)), readFile: async (path: string) => readFileSync(join(top, path)) };
      const plan = await planSync(scan.registry, await loadLock(reader), read, disk);
      if (plan.refused.length > 0 || opts.dryRun) {
        io.stdout(renderSync(plan, opts.format, false));
        if (plan.refused.length > 0) code = 1;
        return;
      }
      if (scan.generated.error !== null) {
        throw new BuildError(`${GENERATED_FILE} is not valid: ${scan.generated.error}; fix it first: sync fills what it brings in, which would replace it`);
      }
      await applySync(top, plan);
      // Only fills of what sync wrote: any other gap is build's to report.
      const wrote = new Set(plan.writes.map((w) => w.path));
      const now = fsReader(top, { local: false });
      const after = await scanRepo(now);
      const fill = await planFill(after, now, (paths) => gitIgnored(top, paths));
      const ours = fill.actions.filter((a) => a.files.some((f) => f.from.some((s) => wrote.has(s.path))));
      // A copy made from a unit sync removed would keep loading in the other agent. applyFill removes only
      // ctxlock's own unedited output; the action's kind and harness are labels it does not read.
      const gone = new Set(plan.removes);
      const orphans = after.generated.files.filter((g) => g.from.length > 0 && g.from.every((s) => gone.has(s.path))).map((g) => g.path);
      if (orphans.length > 0) ours.push({ kind: 'skill-copy', harness: 'claude-code', target: '', files: [], remove: orphans });
      const { written, removed } = await applyFill(top, { ...fill, actions: ours }, after.generated.files);
      io.stdout(renderSync(plan, opts.format, true, { written, removed }));
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
      const { base, head } = await scansAt(root, opts);
      const result = diffScans(base, head);
      io.stdout(opts.format === 'markdown' ? renderDiffMarkdown(result) : renderDiff(result, opts.format));
      if ([...result.newFindings, ...result.execChanges].some((f) => f.severity === 'must')) code = 1;
    });

  program
    .command('who-uses <unit> [dir]')
    .description('list what depends on a unit, the consumers that use it, and the agents predicted to load it')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .action(async (unit: string, dir: string | undefined, opts: { format: 'text' | 'json' }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const scan = await scanRepo(fsReader(root));
      const found = resolveRef(unit, scan.units);
      if (!found) throw new UsageError(`no unit at ${unit}`);
      const uses = whoUses(buildGraph({ ...scan, generated: scan.generated.files }), found.id);
      const seen = sessionsAt(root, scan);
      const loaded = seen.units.find((u) => u.id === found.id) ?? null;
      // Only for a unit a session could be seen loading: "0 of N" says nothing about one Claude Code never reports.
      const observed = loaded || seen.unseen.some((u) => u.id === found.id) ? { sessions: seen.sessions, unit: loaded } : undefined;
      io.stdout(renderWhoUses(observed ? { ...uses, observed } : uses, opts.format));
    });

  program
    .command('loads [dir]')
    .description('list which units Claude Code loaded in the sessions the collector recorded, and which it never did')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .action(async (dir: string | undefined, opts: { format: 'text' | 'json' }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      io.stdout(renderLoads(sessionsAt(root, await scanRepo(fsReader(root))), opts.format));
    });

  program
    .command('misses [dir]')
    .description("list the units in play when you stopped or corrected Claude Code, read from the transcripts of the sessions the collector recorded here; nothing is stored")
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .option('--since <date>', 'only sessions begun on or after this date, as YYYY-MM-DD', day)
    .option('--min-sessions <n>', 'the sessions a unit needs to be routed to its owner', count, 3)
    .option('--excerpts', 'include the opening of each correction you typed, redacted in drafts')
    .option('--drafts <folder>', "write a note to each routed unit's owner into this folder")
    .action(async (dir: string | undefined, opts: { format: 'text' | 'json'; since?: string; minSessions: number; excerpts?: boolean; drafts?: string }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const scan = await scanRepo(fsReader(root));
      const misses = await missesAt(root, scan, opts);
      io.stdout(renderMisses(misses, opts.format, opts.excerpts ?? false));
      if (opts.drafts === undefined) return;

      // JSON on stdout stays parseable.
      const say = opts.format === 'json' ? io.stderr : io.stdout;
      const routed = misses.units.filter((u) => u.routed);
      if (routed.length === 0) {
        say('\nNo unit is routed, so no draft was written.\n');
        return;
      }
      const here = await repoName(root);
      const drafts = routed.map((u) => ({ name: draftName(u.id), id: u.id, kind: 'miss' as const, text: renderDraft(u, shareable(u.upstream?.repo ?? here), opts.excerpts ?? false) }));
      say(writeDrafts(resolve(opts.drafts), drafts, 'Drafts written'));
    });

  program
    .command('diagnose <unit> [dir]')
    .description("ask Claude what went wrong when a unit was in context as you stopped or corrected Claude Code, and check its smallest fix by replay; sends the unit's text and the redacted moments, and writes nothing to the repository")
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .option('--since <date>', 'only sessions begun on or after this date, as YYYY-MM-DD', day)
    .option('--runs <n>', 'runs a side in the replay, at least 2', replayRuns, 2)
    .option('--max-runs <n>', 'the most runs the replay may start', count, 16)
    .option('--max-minutes <n>', 'start no replay run after this many minutes', count, 15)
    .option('--model <model>', 'the model Claude Code runs (default: eval.model, or sonnet)')
    .option('--claude <path>', "Claude Code's executable (default: claude on PATH)")
    .option('--workdir <dir>', 'where run folders go (default: $RUNNER_TEMP, or the system temp folder)')
    .option('--drafts <folder>', "write the proposal for the unit's owner into this folder")
    .option('--open', "file the proposal as an issue in the unit's GitHub repository, or update the one filed before; for a defect or a gap")
    .option('--gh <path>', "GitHub CLI's executable (default: gh on PATH)")
    .action(async (ref: string, dir: string | undefined, opts: DiagnoseFlags) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const scan = await scanRepo(fsReader(root));
      const unit = resolveRef(ref, scan.units);
      if (!unit) throw new UsageError(`ctxlock diagnose: no unit ${ref}; ctxlock scan lists the units`);
      const miss = (await missesAt(root, scan, { minSessions: 1, since: opts.since })).units.find((u) => u.id === unit.id);
      if (!miss) throw new UsageError(`ctxlock diagnose: no signal had ${unit.id} in context; ctxlock misses lists the units that did`);
      const repo = miss.upstream?.repo ?? (await repoName(root));
      // Checked before Claude runs, so a wrong repository costs nothing.
      const github = githubRepo(repo);
      if (opts.open && !github) throw new UsageError(`ctxlock diagnose --open: ${shareable(repo)} is not a GitHub repository`);
      const p = await diagnose({
        root,
        miss,
        model: opts.model ?? scan.registry.eval.model,
        claude: claudeOf(opts.claude),
        workdir: workdirOf(opts.workdir),
        runs: opts.runs,
        maxRuns: opts.maxRuns,
        maxMinutes: opts.maxMinutes,
      });
      io.stdout(renderDiagnosis(p, opts.format));
      const text = renderProposal(p, shareable(repo));
      const say = opts.format === 'json' ? io.stderr : io.stdout;
      if (opts.drafts !== undefined) say(writeDrafts(resolve(opts.drafts), [{ name: `${draftName(unit.id).slice(0, -'.md'.length)}.fix.md`, id: unit.id, kind: 'fix', text }], 'Proposal written'));
      if (!opts.open) return;
      const { verdict } = p.diagnosis;
      if (verdict !== 'defect' && verdict !== 'gap') return say(`\nNo issue filed: the verdict is ${verdict}, so there is nothing for the unit to fix.\n`);
      const issue = await openIssue(github!, `ctxlock: ${unit.id} needs a look`, text, `<!-- ctxlock:fix ${unit.id} `, opts.gh === undefined ? undefined : [opts.gh]);
      say(`\n${issue.created ? 'Issue filed' : issue.reopened ? 'Issue reopened and updated' : 'Issue updated'}: ${issue.url}\n`);
    });

  program
    .command('outcomes [dir]')
    .description('the fixes diagnose proposed that shipped, whether each held at 7 and 30 days, helpful and harmful sessions per unit version, and the compounding numbers; reads git, the collector and the transcripts, and runs nothing')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'))
    .option('--locks <paths...>', 'also count the repositories under these folders whose ctxlock.lock pins a fixed unit at a version from the fix on')
    .action(async (dir: string | undefined, opts: { format: 'text' | 'json'; locks?: string[] }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const scan = await scanRepo(fsReader(root));
      const { fixes, orphans, git } = await shippedFixes(root, scan);
      const r = recordedAt(root);
      const timelines = sessionTimelines(r.read, scan, r.roots, r.real);
      const { found } = await missesAt(root, scan, { minSessions: 1 });
      const locks = opts.locks ? await locksAt(opts.locks, io.stderr) : [];
      const top = await gitTopLevel(root);
      const self = top ? [await gitOrigin(top), top].filter((s) => s !== null) : [root];
      const graph = buildGraph({ ...scan, generated: scan.generated.files });
      const now = new Date();
      const outcomes = fixes.map((fix) => {
        const path = scan.units.find((u) => u.id === fix.unit)!.path;
        const pins = pinnedBy([path], self, locks, real).filter((p) => fix.versions.some((v) => v.unit === p.digest));
        return outcomeOf(fix, timelines, found, now, { consumers: whoUses(graph, fix.unit).consumers.map((c) => c.name), pinnedBy: [...new Set(pins.map((p) => shareable(p.repo)))] });
      });
      const sessions = joinSessions(r.read, scan, r.roots, r.real);
      io.stdout(renderOutcomes({ sessions: sessions.sessions, git, fixes: outcomes, orphans: orphans.map((p) => p.id), counters: counters(timelines, found, scan, fixes), numbers: numbers(outcomes, sessions) }, opts.format));
    });

  program
    .command('report [dir]')
    .description("write what Claude Code loaded in this repository's recorded sessions as JSON to share with your org; it holds no session ID, local path or error message")
    .option('--out <file>', 'the file to write (default: stdout)')
    .action(async (dir: string | undefined, opts: { out?: string }) => {
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const scan = await scanRepo(fsReader(root));
      const top = await gitTopLevel(root);
      const origin = top ? await gitOrigin(top) : null;
      const report = buildReport(sessionsAt(root, scan), scan, origin ?? basename(real(top ?? root)));
      const text = `${JSON.stringify(report, null, 2)}\n`;
      if (opts.out === undefined) io.stdout(text);
      else {
        writeFileSync(resolve(opts.out), text);
        io.stdout(`ctxlock report: wrote ${opts.out}\n`);
      }
    });

  program
    .command('impact [dir]')
    .description("list what a change reaches through ctxlock.yaml's depends-on and consumers, and whose approval it needs")
    .requiredOption('--base <ref>', 'the ref to compare against, such as origin/main')
    .option('--head <ref>', 'the ref to check (default: the working tree)')
    .addOption(new Option('--format <format>', 'output format').choices(['text', 'json', 'markdown']).default('text'))
    .option('--locks <paths...>', 'also list the repositories under these folders whose ctxlock.lock pins a changed unit')
    .action(async (dir: string | undefined, opts: { base: string; head?: string; format: 'text' | 'json' | 'markdown'; locks?: string[] }) => {
      markdown = opts.format === 'markdown';
      const root = resolve(dir ?? '.');
      if (!isDirectory(root)) throw new UsageError(`ctxlock: ${dir} is not a directory`);
      const top = await gitTopLevel(root);
      if (top === null) throw new UsageError(`ctxlock impact: ${dir ?? '.'} is not inside a git repository`);
      const { base, head } = await scansAt(root, opts);
      const impact = impactOf(base, head);
      if (opts.locks) {
        const locks = await locksAt(opts.locks, io.stderr);
        const self = [await gitOrigin(top), top].filter((s) => s !== null);
        impact.pinned = pinnedBy(impact.changed.map((c) => c.id.slice(c.id.indexOf('/') + 1)), self, locks, real);
      }
      io.stdout(renderImpact(impact, opts.format));
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
      // Ids and reasons carry the model's text.
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
    const known = [UsageError, RegistryError, RefNotFound, EvalError, ProbeError, ClaudeNotFound, DraftError, DiagnosisError, IssueError, FixesError, BuildError, UpstreamError, LockError].some((type) => err instanceof type);
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
