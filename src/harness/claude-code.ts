import { posix } from 'node:path';
import type { Unit } from '../model.js';
import { findImports } from './imports.js';
import type { EffectiveContext, LoadEntry, ResolveInput } from './types.js';

export const CLAUDE_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
const FALLBACK_FILES = ['AGENTS.md', '.claude/AGENTS.md'];

export const at = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export function ancestry(site: string): string[] {
  const dirs = [''];
  const parts = site ? site.split('/') : [];
  for (let i = 1; i <= parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

const dirOf = (path: string) => (posix.dirname(path) === '.' ? '' : posix.dirname(path));

// The directory a .claude/rules or .claude/skills path belongs to, or null if it is not under one.
function ownerDir(path: string, folder: string): string | null {
  if (path.startsWith(`${folder}/`)) return '';
  const i = path.indexOf(`/${folder}/`);
  return i === -1 ? null : path.slice(0, i);
}

export function stringField(fm: Record<string, unknown> | null, key: string): string {
  const value = fm?.[key];
  return typeof value === 'string' ? value : '';
}

// Predictions from Claude Code's documented loading rules (research/08 §1, re-checked against
// code.claude.com/docs/en/memory and /skills on 2026-11-05). Spike S4 checks them against real
// InstructionsLoaded events.
export async function resolveClaudeCode({ reader, units, limits }: ResolveInput, site: string): Promise<EffectiveContext> {
  const byPath = new Map<string, Unit>();
  for (const unit of units) {
    byPath.set(unit.path, unit);
    for (const alias of unit.aliases) byPath.set(alias, unit);
  }
  const files = new Set(await reader.listFiles());
  const entries: LoadEntry[] = [];
  const notes: string[] = [];
  const loadedPaths = new Set<string>();
  const loadedUnits = new Set<string>();
  const queue: Array<{ path: string; text: string; hop: number }> = [];

  async function loadAlways(path: string, reason: string, hop: number): Promise<void> {
    if (loadedPaths.has(path)) return;
    loadedPaths.add(path);
    const unit = byPath.get(path);
    let bytes: number;
    let text: string;
    if (unit) {
      bytes = unit.files[0]!.bytes;
      text = unit.text;
    } else {
      const buf = await reader.readFile(path);
      bytes = buf.length;
      text = buf.toString('utf8');
    }
    if (bytes > limits.claudeLaunchFileBytes) {
      notes.push(`${path} skipped by Claude Code: larger than ${limits.claudeLaunchFileBytes / 1024 / 1024} MiB`);
      return;
    }
    entries.push({ unitId: unit?.id ?? `file/${path}`, path, mode: 'always', reason, bytes, loadedBytes: bytes });
    if (unit) loadedUnits.add(unit.id);
    queue.push({ path, text, hop });
  }

  const dirs = ancestry(site);
  const below = (dir: string) => dir !== site && (site === '' || dir.startsWith(`${site}/`));
  // Files Claude Code reads on demand are cut to their first claudeLazyFileChars characters.
  const lazyBytes = (unit: Unit) => Buffer.byteLength(unit.text.slice(0, limits.claudeLazyFileChars));

  const claudeFiles = dirs.flatMap((d) => CLAUDE_FILES.map((name) => at(d, name))).filter((p) => byPath.has(p));
  const agentsFiles = dirs.flatMap((d) => FALLBACK_FILES.map((name) => at(d, name))).filter((p) => byPath.has(p));
  const fallback = claudeFiles.length === 0;

  for (const path of claudeFiles) await loadAlways(path, 'ancestor', 0);
  if (fallback) for (const path of agentsFiles) await loadAlways(path, 'agents-md-fallback', 0);

  const rules = units.filter((u) => u.kind === 'rule');
  for (const rule of rules) {
    if (dirs.includes(ownerDir(rule.path, '.claude/rules')!) && rule.frontmatter?.paths === undefined) {
      await loadAlways(rule.path, 'rule', 0);
    }
  }

  while (queue.length > 0) {
    const { path, text, hop } = queue.shift()!;
    if (hop >= limits.claudeImportHops) continue;
    for (const target of findImports(text)) {
      if (target.startsWith('~/')) {
        const note = `external import ${target} not resolvable in repo`;
        if (!notes.includes(note)) notes.push(note);
        continue;
      }
      if (posix.isAbsolute(target)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(path), target));
      if (resolved.startsWith('../') || !(files.has(resolved) || byPath.has(resolved))) continue;
      await loadAlways(resolved, `import:${path}`, hop + 1);
    }
  }

  for (const path of agentsFiles) {
    if (claudeFiles.length > 0 && !loadedUnits.has(byPath.get(path)!.id)) {
      notes.push(`AGENTS.md at ${path} not loaded by Claude Code: ${claudeFiles[0]} exists`);
    }
  }

  for (const rule of rules) {
    const dir = ownerDir(rule.path, '.claude/rules')!;
    const reason = dirs.includes(dir) ? (rule.frontmatter?.paths === undefined ? null : 'paths-glob') : below(dir) ? 'nested-rules' : null;
    if (!reason) continue;
    entries.push({ unitId: rule.id, path: rule.path, mode: 'lazy', reason, bytes: rule.files[0]!.bytes, loadedBytes: lazyBytes(rule) });
  }

  for (const unit of units) {
    if (unit.kind !== 'instructions' || loadedUnits.has(unit.id) || !below(dirOf(unit.path))) continue;
    const name = posix.basename(unit.path);
    const dir = dirOf(unit.path);
    let reason: string | null = null;
    if (name === 'CLAUDE.md' || name === 'CLAUDE.local.md') reason = 'nested';
    // Read only in fallback mode, and only where the directory has no CLAUDE.md of its own.
    else if (name === 'AGENTS.md' && fallback && posix.basename(dir) !== '.claude' && !CLAUDE_FILES.some((f) => byPath.has(at(dir, f)))) {
      reason = 'nested-agents-md';
    }
    if (!reason) continue;
    entries.push({ unitId: unit.id, path: unit.path, mode: 'lazy', reason, bytes: unit.files[0]!.bytes, loadedBytes: lazyBytes(unit) });
  }

  for (const unit of units) {
    if (unit.kind !== 'skill') continue;
    const claudePaths = [unit.path, ...unit.aliases].filter((p) => ownerDir(p, '.claude/skills') !== null);
    if (claudePaths.length === 0) {
      notes.push(`skill ${unit.name} not visible to Claude Code: .agents/skills is not scanned (anthropics/claude-code#31005)`);
      continue;
    }
    // Listed at launch from the site and every parent; below the site, once Claude works there.
    const listedPath = claudePaths.find((p) => dirs.includes(ownerDir(p, '.claude/skills')!));
    const claudePath = listedPath ?? claudePaths.find((p) => below(ownerDir(p, '.claude/skills')!));
    if (!claudePath) continue;
    if (unit.frontmatter?.['disable-model-invocation'] === true) {
      notes.push(`skill ${unit.name} omitted from Claude Code's listing: disable-model-invocation is set`);
      continue;
    }
    const listing = stringField(unit.frontmatter, 'description').length + stringField(unit.frontmatter, 'when_to_use').length;
    const catalogChars = unit.name.length + Math.min(listing, limits.claudeSkillEntryChars);
    entries.push({
      unitId: unit.id,
      path: claudePath,
      mode: listedPath ? 'listed' : 'lazy',
      reason: listedPath ? 'skill-catalog' : 'nested-skills',
      bytes: unit.files.find((f) => f.path.endsWith('/SKILL.md'))?.bytes ?? 0,
      loadedBytes: 0,
      catalogChars,
    });
  }

  const alwaysBytes = entries.filter((e) => e.mode === 'always').reduce((sum, e) => sum + e.loadedBytes, 0);
  return { harness: 'claude-code', site, entries, alwaysBytes, notes };
}
