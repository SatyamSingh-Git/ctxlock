#!/usr/bin/env node
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, Option } from 'commander';
import { diffScans } from './diff.js';
import { RegistryError } from './registry/registry.js';
import { fsReader, gitReader, gitTopLevel, RefNotFound } from './repo/reader.js';
import { renderDiffMarkdown, renderErrorMarkdown } from './report/markdown.js';
import { renderDiff, renderScan } from './report/render.js';
import { scanRepo } from './scan.js';

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

class UsageError extends Error {}

const isDirectory = (dir: string) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;

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

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    // Commander has already printed its own message; help and version exit 0.
    if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : 2;
    // Anything else is a bug or input ctxlock cannot handle. It still exits 2, because 1 means must-fix.
    const known = err instanceof UsageError || err instanceof RegistryError || err instanceof RefNotFound;
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
