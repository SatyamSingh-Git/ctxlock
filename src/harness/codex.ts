import { posix } from 'node:path';
import type { Unit } from '../model.js';
import { CLAUDE_FILES, ancestry, at } from './claude-code.js';
import type { EffectiveContext, LoadEntry, ResolveInput } from './types.js';

const CHAIN_FILES = ['AGENTS.override.md', 'AGENTS.md'];

// Predictions from Codex's loader, codex-rs/core/src/agents_md.rs (research/08 §2).
// codex.conformance.test.ts holds Codex's own loader tests, ported, since we cannot run Codex.
export async function resolveCodex({ units, limits }: ResolveInput, site: string): Promise<EffectiveContext> {
  const byPath = new Map<string, Unit>();
  for (const unit of units) {
    byPath.set(unit.path, unit);
    for (const alias of unit.aliases) byPath.set(alias, unit);
  }
  const entries: LoadEntry[] = [];
  const notes: string[] = [];
  const dirs = ancestry(site);
  const budget = limits.codexChainBytes;

  let remaining = budget;
  for (const dir of dirs) {
    const path = CHAIN_FILES.map((name) => at(dir, name)).find((p) => byPath.has(p));
    if (!path) continue;
    const unit = byPath.get(path)!;
    const bytes = unit.files[0]!.bytes;
    if (remaining === 0) {
      if (!entries.some((e) => e.reason === 'chain-dropped')) {
        notes.push(`Codex skips ${path} and later AGENTS files: the ${budget}-byte project instruction budget is used up`);
      }
      entries.push({ unitId: unit.id, path, mode: 'always', reason: 'chain-dropped', bytes, loadedBytes: 0 });
      continue;
    }
    const loadedBytes = Math.min(bytes, remaining);
    if (loadedBytes < bytes) {
      notes.push(`Codex loads only ${loadedBytes} of ${bytes} bytes from ${path} under the ${budget}-byte project instruction budget`);
    }
    remaining -= loadedBytes;
    entries.push({ unitId: unit.id, path, mode: 'always', reason: 'chain', bytes, loadedBytes });
  }

  const hasClaudeFiles = dirs.some((d) => CLAUDE_FILES.some((name) => byPath.has(at(d, name))));
  if (hasClaudeFiles && entries.length === 0) notes.push('CLAUDE.md content not visible to Codex');

  const skillRoots = new Set(dirs.map((d) => at(d, '.agents/skills')));
  for (const unit of units) {
    if (unit.kind !== 'skill') continue;
    const paths = [unit.path, ...unit.aliases];
    const codexPath = paths.find((p) => skillRoots.has(posix.dirname(p)));
    if (!codexPath) {
      const anyAgentsPath = paths.some((p) => p.startsWith('.agents/skills/') || p.includes('/.agents/skills/'));
      if (!anyAgentsPath) notes.push(`skill ${unit.name} not visible to Codex: .claude/skills is not scanned`);
      continue;
    }
    const description = unit.frontmatter?.description;
    entries.push({
      unitId: unit.id,
      path: codexPath,
      mode: 'listed',
      reason: 'skill-catalog',
      bytes: unit.files.find((f) => f.path.endsWith('/SKILL.md'))?.bytes ?? 0,
      loadedBytes: 0,
      catalogChars: unit.name.length + (typeof description === 'string' ? description.length : 0) + codexPath.length,
    });
  }

  const alwaysBytes = entries.filter((e) => e.mode === 'always').reduce((sum, e) => sum + e.loadedBytes, 0);
  return { harness: 'codex', site, entries, alwaysBytes, notes };
}
