#!/usr/bin/env node
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, Option } from 'commander';
import { RegistryError } from './registry/registry.js';
import { fsReader, RefNotFound } from './repo/reader.js';
import { renderScan } from './report/render.js';
import { scanRepo } from './scan.js';

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

class UsageError extends Error {}

const isDirectory = (dir: string) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;

export async function main(argv: string[], io: Io): Promise<number> {
  let code = 0;
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

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    // Commander has already printed its own message; help and version exit 0.
    if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : 2;
    if (err instanceof UsageError || err instanceof RegistryError || err instanceof RefNotFound) {
      io.stderr(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
  return code;
}

// Run when executed as the ctxlock binary (including through an npm bin symlink), not when imported.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) });
}
