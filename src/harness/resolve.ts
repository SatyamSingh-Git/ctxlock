import { posix } from 'node:path';
import type { HarnessId, Unit } from '../model.js';
import { resolveClaudeCode } from './claude-code.js';
import { resolveCodex } from './codex.js';
import type { EffectiveContext, ResolveInput } from './types.js';

export const RESOLVERS: Record<HarnessId, (input: ResolveInput, site: string) => Promise<EffectiveContext>> = {
  'claude-code': resolveClaudeCode,
  codex: resolveCodex,
};

// A site is a directory an agent could be started in. `.claude/CLAUDE.md` belongs to the
// directory that holds `.claude`.
export function contextSites(units: Unit[]): string[] {
  const sites = new Set(['']);
  for (const unit of units) {
    if (unit.kind !== 'instructions') continue;
    for (const path of [unit.path, ...unit.aliases]) {
      let dir = posix.dirname(path);
      if (posix.basename(dir) === '.claude') dir = posix.dirname(dir);
      sites.add(dir === '.' ? '' : dir);
    }
  }
  return [...sites].sort();
}

export async function resolveAll(input: ResolveInput, harnesses: HarnessId[]): Promise<EffectiveContext[]> {
  const sites = contextSites(input.units);
  const contexts: EffectiveContext[] = [];
  for (const harness of harnesses) {
    for (const site of sites) contexts.push(await RESOLVERS[harness](input, site));
  }
  return contexts;
}
