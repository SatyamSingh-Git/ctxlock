import { isAbsolute, relative, sep } from 'node:path';
import { fallbackLoads, loadReason, unitsByPath } from '../eval/loads.js';
import { ancestry, ownerDir } from '../harness/claude-code.js';
import type { LoadEntry, LoadMode } from '../harness/types.js';
import type { Unit } from '../model.js';
import type { ScanResult } from '../scan.js';
import type { RecordedEvent } from './events.js';

export interface UnitLoads {
  id: string;
  path: string;
  sessions: number;
  reasons: string[];
  lastSeen: string;
  // Sessions that loaded bytes other than the scanned unit's.
  otherVersion: number;
  // No session reported it: an AGENTS.md read through Claude Code's fallback.
  predicted: boolean;
}

export interface Sessions {
  sessions: number;
  first: string | null;
  last: string | null;
  units: UnitLoads[];
  unseen: Array<{ id: string; path: string; mode: LoadMode }>;
  undeclared: boolean;
  // Errors and unread lines are counted over the whole store: an error belongs to no session.
  errors: { count: number; last?: { ts: string; message: string } };
  skipped: number;
}

interface Load {
  unit: Unit;
  ts: string;
  reason: string;
  other: boolean;
  observed: boolean;
}

// The path from a root, with / separators, or null when the path is under none of them.
function within(path: string, roots: string[]): string | null {
  for (const root of roots) {
    const rel = relative(root, path);
    if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return rel.replaceAll(sep, '/');
  }
  return null;
}

// real gives a path's real one. A session started through a junction or an 8.3 name records that name,
// and a path the agent typed can differ in case below the top.
export function joinSessions(
  read: { events: RecordedEvent[]; skipped: number },
  scan: ScanResult,
  roots: string[],
  real: (path: string) => string = (path) => path,
): Sessions {
  const folderOf = (cwd: string) => within(real(cwd), roots) ?? within(cwd, roots);
  const fileOf = (file: string) => within(file, roots) ?? within(real(file), roots);
  const byPath = unitsByPath(scan);
  const unitAt = (file: string) => byPath.get(within(file, roots) ?? '') ?? byPath.get(within(real(file), roots) ?? '');
  const byId = new Map(scan.units.map((u) => [u.id, u]));
  const contexts = new Map(scan.contexts.filter((c) => c.harness === 'claude-code').map((c) => [c.site, c.entries]));
  // What some session could have been seen loading.
  const seeable = new Map<string, Sessions['unseen'][number]>();

  const bySession = new Map<string, Exclude<RecordedEvent, { event: 'error' }>[]>();
  let errors = 0;
  let lastError: { ts: string; message: string } | undefined;
  for (const e of read.events) {
    if (e.event === 'error') {
      errors++;
      if (!lastError || e.ts >= lastError.ts) lastError = { ts: e.ts, message: e.message };
    } else bySession.set(e.session, [...(bySession.get(e.session) ?? []), e]);
  }

  const tally = new Map<string, Omit<UnitLoads, 'reasons' | 'predicted'> & { reasons: Set<string>; observed: boolean }>();
  let sessions = 0;
  const stamps: string[] = [];
  for (const events of bySession.values()) {
    if (!events.some((e) => folderOf(e.cwd) !== null || (e.event === 'load' && fileOf(e.file) !== null))) continue;
    sessions++;
    const ordered = [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const begun = ordered[0]!.ts;
    stamps.push(begun, ordered.at(-1)!.ts);

    // A session sees what the folder it started in sees. The deepest site above that folder has the
    // same instruction files above it, and Claude Code offers the skills of the folder and every folder
    // above. A skill below can share a name with one of Claude Code's own, so no call is credited to it.
    const folder = folderOf(ordered[0]!.cwd) ?? '';
    const site = [...contexts.keys()].filter((s) => s === '' || folder === s || folder.startsWith(`${s}/`)).reduce((a, b) => (b.length > a.length ? b : a), '');
    const above = ancestry(folder);
    const offered = (e: LoadEntry) => above.includes(ownerDir(e.path, '.claude/skills')!);
    const skills = new Map<string, Unit>();
    for (const e of contexts.get(site) ?? []) {
      const unit = byId.get(e.unitId);
      // Claude Code reports nothing for an AGENTS.md it reads through its fallback.
      if (!unit || e.reason === 'nested-agents-md' || (unit.kind === 'skill' && !offered(e))) continue;
      if (unit.kind === 'skill') skills.set(unit.name, unit);
      seeable.set(unit.id, { id: unit.id, path: e.path, mode: unit.kind === 'skill' ? 'listed' : e.mode });
    }

    const loads: Load[] = [];
    for (const e of ordered) {
      const unit = e.event === 'load' ? unitAt(e.file) : e.event === 'skill' ? skills.get(e.skill) : undefined;
      if (!unit) continue;
      const other = e.event === 'load' && e.sha256 !== null && e.sha256 !== unit.files[0]!.sha256;
      loads.push({ unit, ts: e.ts, reason: e.event === 'load' ? loadReason(e.reason) : 'skill_invoked', other, observed: true });
    }
    for (const { unit, reason } of fallbackLoads(scan, new Set(loads.map((l) => l.unit.id)), site)) {
      loads.push({ unit, ts: begun, reason, other: false, observed: false });
    }

    for (const id of new Set(loads.map((l) => l.unit.id))) {
      const mine = loads.filter((l) => l.unit.id === id);
      const t = tally.get(id) ?? { id, path: mine[0]!.unit.path, sessions: 0, reasons: new Set(), lastSeen: '', otherVersion: 0, observed: false };
      t.sessions++;
      for (const l of mine) {
        t.reasons.add(l.reason);
        if (l.ts > t.lastSeen) t.lastSeen = l.ts;
      }
      if (mine.some((l) => l.other)) t.otherVersion++;
      if (mine.some((l) => l.observed)) t.observed = true;
      tally.set(id, t);
    }
  }

  const units = [...tally.values()]
    .map(({ reasons, observed, ...t }): UnitLoads => ({ ...t, reasons: [...reasons].sort(), predicted: !observed }))
    .sort((a, b) => b.sessions - a.sessions || (a.path < b.path ? -1 : 1));
  const unseen = [...seeable.values()].filter((u) => !tally.has(u.id)).sort((a, b) => (a.path < b.path ? -1 : 1));

  stamps.sort();
  return {
    sessions,
    first: stamps[0] ?? null,
    last: stamps.at(-1) ?? null,
    units,
    unseen,
    undeclared: sessions > 0 && !scan.registry.consumers.some((c) => c.harnesses.includes('claude-code')),
    errors: { count: errors, ...(lastError !== undefined && { last: lastError }) },
    skipped: read.skipped,
  };
}
