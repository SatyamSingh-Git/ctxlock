import { loadGenerated } from '../../src/build/generated.js';
import { LIMITS } from '../../src/harness/limits.js';
import { resolveAll } from '../../src/harness/resolve.js';
import type { LintContext } from '../../src/lint/types.js';
import { loadCodeowners } from '../../src/registry/codeowners.js';
import { loadRegistry } from '../../src/registry/registry.js';
import { readLock } from '../../src/sync/lock.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from './mem-reader.js';

export async function lintContext(
  files: Record<string, string | Buffer>,
  symlinks: Record<string, string | null> = {},
): Promise<LintContext> {
  const reader = memReader(files, symlinks);
  const { units } = await discoverUnits(reader);
  const registry = await loadRegistry(reader);
  const limits = { ...LIMITS, ...registry.limits };
  const generated = await loadGenerated(reader);
  const lock = await readLock(reader);
  return {
    reader,
    units,
    registry,
    codeowners: await loadCodeowners(reader),
    contexts: await resolveAll({ reader, units, limits }, registry.harnesses),
    limits,
    today: '2026-11-05',
    generated: generated.files,
    generatedError: generated.error,
    lock: lock.lock,
    lockError: lock.error,
  };
}
