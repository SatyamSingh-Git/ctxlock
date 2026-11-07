import { posix } from 'node:path';
import { CLAUDE_FILES, at, ownerDir } from '../harness/claude-code.js';
import { findImports } from '../harness/imports.js';
import { LIMITS } from '../harness/limits.js';
import { home, shadowed } from '../lint/rules/l13-shadowed.js';
import type { HarnessId, Unit } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import type { ScanResult } from '../scan.js';
import { lfDigest } from '../units/digest.js';
import { GENERATED_FILE, type Source } from './generated.js';

export type FillKind = 'skill-copy' | 'claude-import' | 'agents-md';

export interface PlannedFile {
  path: string;
  bytes: Buffer;
  from: Source[];
}

export interface FillAction {
  kind: FillKind;
  harness: HarnessId;
  target: string;
  files: PlannedFile[];
  // Files an earlier copy of a skill has whose source the skill no longer has.
  remove?: string[];
}

// A unit one agent reaches and the other does not. `harness` is the one it misses.
export interface Gap {
  path: string;
  harness: HarnessId;
  fill: string | null;
  reason: string;
  // The fill is there already, out of date: it reaches the harness, with what its sources said before.
  stale?: true;
}

export interface FillPlan {
  actions: FillAction[];
  gaps: Gap[];
}

const FILLS: Record<FillKind, string> = {
  'skill-copy': 'a copy of the skill',
  'claude-import': 'a CLAUDE.md that imports it',
  'agents-md': 'an AGENTS.md from what Claude Code loads there',
};

// F/** or F/**/*: everything under one folder, which Codex scopes with F/AGENTS.md.
const FOLDER_GLOB = /^([^*?[\]{}!]+?)\/\*\*(?:\/\*)?$/;
const MIRRORS: Array<[string, string]> = [['.agents/skills', '.claude/skills'], ['.claude/skills', '.agents/skills']];
const dirOf = (path: string) => (posix.dirname(path) === '.' ? '' : posix.dirname(path));
const onlyImportsAgentsMd = (text: string) => text.trim().split(/\s+/).every((word) => /^@(?:.*\/)?AGENTS\.md$/.test(word));
const tidy = (text: string) => text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
// A skill's file reached through a symlink has its real path, outside the skill's folder.
export const throughLink = (unit: Unit) => unit.files.some((f) => !f.path.startsWith(`${unit.path}/`));
const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// `ignored` gives the paths among those asked about that git would not add.
export async function planFill(scan: ScanResult, reader: RepoReader, ignored: (paths: string[]) => Promise<Set<string>>): Promise<FillPlan> {
  if (!(['claude-code', 'codex'] as const).every((h) => scan.registry.harnesses.includes(h))) return { actions: [], gaps: [] };
  const limits = { ...LIMITS, ...scan.registry.limits };
  const listed = await reader.listFiles();
  const listedSet = new Set(listed);
  const links = [...(await reader.listSymlinks()).keys()];
  const recorded = new Map(scan.generated.files.map((g) => [g.path, g.sha256]));
  const unitAt = new Map(scan.units.map((u) => [u.path, u]));

  // Generated files are committed, so one git ignores helps no one; nor does any fill when git ignores
  // the record of what was generated.
  const recordIgnored = (await ignored([GENERATED_FILE])).size > 0;
  // Why the files at a target cannot be written, or null.
  async function blocked(target: string, paths: string[]): Promise<string | null> {
    if (recordIgnored) return `${GENERATED_FILE} is gitignored`;
    const hits = await ignored(paths);
    const hit = paths.find((p) => hits.has(p));
    if (hit) return `${hit} is gitignored`;
    return (await free(target)) ? null : `${target} exists`;
  }

  // A target ctxlock may write: nothing there, or only files it generated that nobody edited since.
  async function free(target: string): Promise<boolean> {
    if (links.some((l) => l === target || target.startsWith(`${l}/`) || l.startsWith(`${target}/`))) return false;
    for (const path of listed.filter((p) => p === target || p.startsWith(`${target}/`))) {
      if (recorded.get(path) !== lfDigest(await reader.readFile(path))) return false;
    }
    return true;
  }

  const reach = new Map<string, Set<HarnessId>>();
  for (const { harness, entries } of scan.contexts) {
    for (const { unitId } of entries) reach.set(unitId, (reach.get(unitId) ?? new Set()).add(harness));
  }

  const actions: FillAction[] = [];
  const gaps: Gap[] = [];
  const fixes = new Map(shadowed(scan.contexts, scan.generated.files).map((s) => [s.path, s.fix]));
  // Units Codex misses, by the folder whose AGENTS.md would carry them.
  const wanted = new Map<string, Unit[]>();
  const want = (folder: string, unit: Unit) => wanted.set(folder, [...(wanted.get(folder) ?? []), unit]);

  for (const unit of scan.units) {
    // A copy ctxlock made is covered through its source.
    if (unit.files.every((f) => recorded.has(f.path))) continue;
    const harnesses = reach.get(unit.id);
    if (!harnesses || harnesses.size !== 1) continue;
    const missing: HarnessId = harnesses.has('claude-code') ? 'codex' : 'claude-code';
    const gap = (fill: string | null, reason: string) => gaps.push({ path: unit.path, harness: missing, fill, reason });

    if (unit.kind === 'skill') {
      const [from, to] = MIRRORS.find(([f]) => ownerDir(unit.path, f) !== null) ?? [];
      if (!from || !to) {
        gap(null, `no fill for ${unit.kind} files`);
        continue;
      }
      if (throughLink(unit)) {
        gap(null, 'files reached through a symlink; copy by hand');
        continue;
      }
      const mirror = unit.path.replace(`${from}/`, `${to}/`);
      const paths = unit.files.map((f) => `${mirror}${f.path.slice(unit.path.length)}`);
      const why = await blocked(mirror, paths);
      if (why) {
        gap(null, why);
        continue;
      }
      const files = await Promise.all(unit.files.map(async (f, i) => ({ path: paths[i]!, bytes: await reader.readFile(f.path), from: [{ path: f.path, sha256: f.sha256 }] })));
      // The target is free, so every file under it is one ctxlock wrote and nobody edited since.
      const remove = listed.filter((p) => p.startsWith(`${mirror}/`) && !paths.includes(p));
      actions.push({ kind: 'skill-copy', harness: missing, target: mirror, files, ...(remove.length > 0 ? { remove } : {}) });
      gap(mirror, FILLS['skill-copy']);
    } else if (missing === 'claude-code') {
      const fix = fixes.get(unit.path);
      const create = fix ? /^create (\S+) containing/.exec(fix)?.[1] : undefined;
      const why = create && (await blocked(create, [create]));
      if (!fix) gap(null, `no fill for ${unit.kind} files`);
      else if (!create) gap(null, `edit by hand: ${fix}`);
      else if (why) gap(null, why);
      else {
        actions.push({ kind: 'claude-import', harness: missing, target: create, files: [{ path: create, bytes: Buffer.from('@AGENTS.md\n'), from: [] }] });
        gap(create, FILLS['claude-import']);
      }
    } else if (unit.kind === 'instructions') {
      if (posix.basename(unit.path) === 'CLAUDE.local.md' || onlyImportsAgentsMd(unit.text)) continue;
      want(home(unit.path), unit);
    } else if (unit.kind === 'rule') {
      const dir = ownerDir(unit.path, '.claude/rules');
      const paths = unit.frontmatter?.paths;
      if (dir === null) {
        gap(null, `no fill for ${unit.kind} files`);
        continue;
      }
      if (paths === undefined) {
        want(dir, unit);
        continue;
      }
      const patterns = (Array.isArray(paths) ? paths : [paths]).map(String);
      const folders = patterns.map((p) => FOLDER_GLOB.exec(p)?.[1]);
      // Only a folder inside the repository, and outside .git, can hold an AGENTS.md for Codex.
      const outside = (f: string) => posix.isAbsolute(f) || /^[A-Za-z]:/.test(f) || f.split('/').some((part) => part === '..' || part === '.git');
      const bad = patterns.length === 0 ? 'paths: []' : patterns.find((_, i) => folders[i] === undefined || outside(folders[i]!));
      if (bad !== undefined) gap(null, `Codex cannot scope ${bad}`);
      else for (const folder of new Set(folders)) want(posix.join(dir, folder!), unit);
    } else {
      gap(null, `no fill for ${unit.kind} files`);
    }
  }

  for (const [folder, units] of wanted) {
    const target = at(folder, 'AGENTS.md');
    const override = at(folder, 'AGENTS.override.md');
    const why = listedSet.has(override) ? `add it to ${override} by hand` : await blocked(target, [target]);
    if (why) {
      const reason = why === `${target} exists` ? `add it to ${target} by hand` : why;
      for (const unit of units) gaps.push({ path: unit.path, harness: 'codex', fill: null, reason });
      continue;
    }
    // CLAUDE files first, then rules without paths, then scoped rules; each followed by what it imports.
    const rank = (u: Unit) => (u.kind === 'instructions' ? CLAUDE_FILES.indexOf(posix.basename(u.path)) : u.frontmatter?.paths === undefined ? 10 : 20);
    const ordered = [...units].sort((a, b) => rank(a) - rank(b) || byPath(a, b));
    const read = new Map<string, Buffer>();
    const importsOf = async (path: string) => {
      if (!read.has(path)) read.set(path, await reader.readFile(path));
      const found: string[] = [];
      for (const imported of findImports(read.get(path)!.toString('utf8'))) {
        if (imported.startsWith('~/') || posix.isAbsolute(imported)) continue;
        const resolved = posix.normalize(posix.join(dirOf(path), imported));
        if (!resolved.startsWith('../') && listedSet.has(resolved)) found.push(resolved);
      }
      return found;
    };
    // Claude Code follows imports breadth-first, so a file's hop is its shortest import path, however
    // the depth-first walk below first meets it. A Map visits the entries added while it is iterated.
    const hops = new Map(ordered.map((u) => [u.path, 0]));
    for (const [path, hop] of hops) {
      if (hop < limits.claudeImportHops) for (const next of await importsOf(path)) if (!hops.has(next)) hops.set(next, hop + 1);
    }
    const parts: PlannedFile['from'] = [];
    const texts: string[] = [];
    const seen = new Set<string>();
    const visit = async (path: string): Promise<void> => {
      if (seen.has(path)) return;
      seen.add(path);
      const bytes = read.get(path) ?? (await reader.readFile(path));
      const unit = unitAt.get(path);
      parts.push({ path, sha256: lfDigest(bytes) });
      texts.push(unit?.kind === 'rule' ? unit.body : bytes.toString('utf8'));
      if (hops.get(path)! >= limits.claudeImportHops) return;
      for (const next of await importsOf(path)) await visit(next);
    };
    for (const unit of ordered) await visit(unit.path);
    actions.push({ kind: 'agents-md', harness: 'codex', target, files: [{ path: target, bytes: Buffer.from(`${texts.map(tidy).join('\n\n').replaceAll('\r\n', '\n')}\n`), from: parts }] });
    for (const unit of units) gaps.push({ path: unit.path, harness: 'codex', fill: target, reason: FILLS['agents-md'] });
  }

  // A target that already holds what would be written, recorded from the same sources, needs nothing;
  // line endings aside, which a checkout may change. With the same text but changed sources, only the
  // record is refreshed.
  const sources = new Map(scan.generated.files.map((g) => [g.path, JSON.stringify(g.from)]));
  const upToDate = new Set<string>();
  for (const action of actions) {
    const same = await Promise.all(
      action.files.map(async (f) => listedSet.has(f.path) && lfDigest(await reader.readFile(f.path)) === lfDigest(f.bytes) && sources.get(f.path) === JSON.stringify(f.from)),
    );
    if (same.every(Boolean) && !action.remove) upToDate.add(action.target);
  }
  return {
    actions: actions.filter((a) => !upToDate.has(a.target)).sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)),
    gaps: gaps
      .filter((g) => g.fill === null || !upToDate.has(g.fill))
      // A planned target holds only files ctxlock wrote, so any file there is an earlier fill.
      .map((g) => (g.fill !== null && listed.some((p) => p === g.fill || p.startsWith(`${g.fill}/`)) ? { ...g, stale: true as const } : g))
      .sort(byPath),
  };
}
