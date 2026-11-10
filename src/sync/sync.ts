import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { linked, outsideRepo } from '../build/apply.js';
import { BuildError } from '../build/index-suggest.js';
import type { Registry, Upstream } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';
import { scanRepo } from '../scan.js';
import { lfDigest } from '../units/digest.js';
import { UpstreamError } from './fetch.js';
import { LOCK_FILE, type Lock, type LockedUnit, type LockedUpstream, serializeLock } from './lock.js';

export interface SyncChange {
  upstream: string;
  path: string;
  change: 'added' | 'updated' | 'removed' | 'unchanged';
  from?: string;
  to?: string;
}

export interface SyncPlan {
  lock: Lock;
  // Each upstream's commit before this sync, null the first time, and after.
  moved: Array<{ upstream: string; ref: string; from: string | null; to: string }>;
  writes: Array<{ path: string; bytes: Buffer }>;
  removes: string[];
  changes: SyncChange[];
  // A person's file, or a synced file edited since: sync writes nothing while any is here.
  refused: Array<{ path: string; reason: string }>;
  // Files sync wrote and someone edited since, whose unit or skill file sync no longer takes: they
  // stay, as the person's, and leave the lock.
  released: string[];
  // Units taken though they run hooks or grant tools, as allow-exec permits.
  allowedExec: string[];
  // Files inside an upstream skill that configure the agent rather than instruct it (§7).
  skipped: Array<{ path: string; reason: string }>;
}

function never(unitPath: string, path: string): string | null {
  const parts = path.slice(unitPath.length + 1).split('/');
  if (parts.slice(0, -1).includes('hooks')) return 'hooks never sync';
  if (parts.at(-1) === '.mcp.json') return 'MCP servers never sync';
  if (parts.at(-1) === 'settings.json' || parts.at(-1) === 'settings.local.json') return 'settings never sync';
  return null;
}

// A name git accepts can still mean another place to a file system: a . or .. segment, a backslash on
// Windows, an NTFS stream after a colon. Control characters are refused with them.
const cp = String.fromCodePoint;
const ODD = new RegExp(`[\\\\:${cp(0)}-${cp(31)}${cp(127)}]`);
const unsafe = (path: string) => ODD.test(path) || path.split('/').some((s) => s === '' || s === '.' || s === '..');

export const EXEC_REASON = 'its frontmatter runs hooks or grants tools; name it under allow-exec to take it';

const byPath = <T extends { path: string }>(a: T, b: T) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// What syncing every upstream the registry declares would write, remove and pin. A unit lands at its
// upstream path (D69); only skills and rules sync (D71); a synced unit keeps its upstream tier (D72).
export async function planSync(
  registry: Registry,
  lock: Lock,
  read: (u: Upstream) => Promise<{ commit: string; reader: RepoReader }>,
  // The files on disk, ignored ones too: sync never writes over a file it did not write.
  local: Pick<RepoReader, 'exists' | 'readFile'>,
): Promise<SyncPlan> {
  const previous = new Map(lock.upstreams.map((u) => [u.name, u]));
  // Every file an earlier sync wrote, with what it wrote.
  const written = new Map(lock.upstreams.flatMap((u) => u.units.flatMap((x) => Object.entries(x.files))));
  const now = async (path: string) => ((await local.exists(path)) ? lfDigest(await local.readFile(path)) : null);
  const plan: SyncPlan = { lock: { upstreams: [] }, moved: [], writes: [], removes: [], changes: [], refused: [], released: [], allowedExec: [], skipped: [] };
  const kept = new Set<string>();

  for (const u of registry.upstreams) {
    const { commit, reader } = await read(u);
    const scan = await scanRepo(reader);
    const before = new Map((previous.get(u.name)?.units ?? []).map((x) => [x.path, x]));
    const units: LockedUnit[] = [];
    for (const path of u.units) {
      const unit = scan.units.find((x) => x.path === path);
      if (!unit) throw new UpstreamError(`upstream ${u.name}: ${path} is no unit at ${commit.slice(0, 7)}`);
      if (unit.kind !== 'skill' && unit.kind !== 'rule') throw new UpstreamError(`upstream ${u.name}: ${path} is ${unit.kind}; only skills and rules sync`);

      // Claude Code runs a skill's hooks and grants its allowed-tools without asking (§7).
      if (scan.inventory.some((f) => f.unitId === unit.id)) {
        if (u.allowExec.includes(unit.path)) plan.allowedExec.push(unit.path);
        else plan.refused.push({ path: unit.path, reason: EXEC_REASON });
      }
      const files: Record<string, string> = {};
      for (const f of unit.files) {
        if (unsafe(f.path)) throw new UpstreamError(`upstream ${u.name}: ${unit.path} holds a file sync will not write: ${JSON.stringify(f.path)}`);
        // A skill's member that is a link is listed by its target, which can be anywhere in the upstream.
        if (unit.kind === 'skill' ? !f.path.startsWith(`${unit.path}/`) : f.path !== unit.path) {
          plan.skipped.push({ path: f.path, reason: `outside ${unit.path}, reached through a link: never syncs` });
          continue;
        }
        const reason = never(unit.path, f.path);
        if (reason) {
          plan.skipped.push({ path: f.path, reason });
          continue;
        }
        const bytes = await reader.readFile(f.path);
        files[f.path] = lfDigest(bytes);
        kept.add(f.path);
        const here = await now(f.path);
        if (here === files[f.path]) continue;
        const was = written.get(f.path);
        if (here !== null && was === undefined) plan.refused.push({ path: f.path, reason: 'a file sync did not write' });
        else if (here !== null && here !== was) plan.refused.push({ path: f.path, reason: 'edited since the last sync' });
        else plan.writes.push({ path: f.path, bytes });
      }
      units.push({ path: unit.path, id: unit.id, digest: unit.digest, tier: scan.registry.units[unit.path]?.tier ?? 'reviewed', files });

      const had = before.get(unit.path);
      if (!had) plan.changes.push({ upstream: u.name, path: unit.path, change: 'added', to: unit.digest });
      else if (had.digest === unit.digest) plan.changes.push({ upstream: u.name, path: unit.path, change: 'unchanged', to: unit.digest });
      else plan.changes.push({ upstream: u.name, path: unit.path, change: 'updated', from: had.digest, to: unit.digest });
    }
    for (const [path, had] of before) if (!u.units.includes(path)) plan.changes.push({ upstream: u.name, path, change: 'removed', from: had.digest });
    const last = previous.get(u.name);
    const pinned: LockedUpstream = { name: u.name, repo: u.repo, ref: u.ref, commit, units };
    // A commit that changed nothing this repository takes keeps the old pin: a pull request that only
    // moves a hash, for every org commit, is noise.
    if (last && serializeLock({ upstreams: [{ ...pinned, commit: last.commit }] }) === serializeLock({ upstreams: [last] })) pinned.commit = last.commit;
    plan.moved.push({ upstream: u.name, ref: u.ref, from: last?.commit ?? null, to: pinned.commit });
    plan.lock.upstreams.push(pinned);
  }
  for (const [name, had] of previous) {
    if (registry.upstreams.some((u) => u.name === name)) continue;
    for (const x of had.units) plan.changes.push({ upstream: name, path: x.path, change: 'removed', from: x.digest });
  }

  // A file an earlier sync wrote that the new lock no longer lists goes, unless someone edited it: then
  // it is theirs. Refusing would leave no way to keep a version of one's own.
  for (const [path, was] of written) {
    if (kept.has(path)) continue;
    const here = await now(path);
    if (here === null) continue;
    if (here === was) plan.removes.push(path);
    else plan.released.push(path);
  }

  plan.writes.sort(byPath);
  plan.removes.sort();
  plan.released.sort();
  plan.allowedExec.sort();
  plan.refused.sort(byPath);
  plan.skipped.sort(byPath);
  plan.changes.sort((a, b) => (a.upstream < b.upstream ? -1 : a.upstream > b.upstream ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return plan;
}

// Writes a plan with no refusals. The lock is rewritten only when what it says changed.
export async function applySync(top: string, plan: SyncPlan): Promise<void> {
  for (const path of [...plan.writes.map((w) => w.path), ...plan.removes, LOCK_FILE]) {
    if (outsideRepo(top, path)) throw new BuildError(`${path} is outside the repository; ctxlock writes only inside it`);
    if (linked(top, path)) throw new BuildError(`${path} is reached through a link; ctxlock writes through none`);
  }
  for (const { path, bytes } of plan.writes) {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), bytes);
  }
  for (const path of plan.removes) rmSync(join(top, path));
  const text = serializeLock(plan.lock);
  const lockPath = join(top, LOCK_FILE);
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) writeFileSync(lockPath, text);
}
