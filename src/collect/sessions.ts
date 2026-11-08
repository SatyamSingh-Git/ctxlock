import { isAbsolute, relative, sep } from 'node:path';
import { fallbackLoads, loadReason, unitsByPath } from '../eval/loads.js';
import type { LoadMode } from '../harness/types.js';
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
  errors: { count: number; last?: string };
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

export function joinSessions(read: { events: RecordedEvent[]; skipped: number }, scan: ScanResult, roots: string[]): Sessions {
  const byPath = unitsByPath(scan);
  const byId = new Map(scan.units.map((u) => [u.id, u]));
  const entries = scan.contexts.find((c) => c.harness === 'claude-code' && c.site === '')?.entries ?? [];
  const listed = new Map(entries.filter((e) => e.mode === 'listed').map((e) => byId.get(e.unitId)!).map((u) => [u.name, u]));

  const bySession = new Map<string, Exclude<RecordedEvent, { event: 'error' }>[]>();
  let errors = 0;
  let lastError: string | undefined;
  for (const e of read.events) {
    if (e.event === 'error') {
      errors++;
      lastError = e.message;
    } else bySession.set(e.session, [...(bySession.get(e.session) ?? []), e]);
  }

  const tally = new Map<string, Omit<UnitLoads, 'reasons' | 'predicted'> & { reasons: Set<string>; observed: boolean }>();
  let sessions = 0;
  const stamps: string[] = [];
  for (const events of bySession.values()) {
    if (!events.some((e) => within(e.cwd, roots) !== null || (e.event === 'load' && within(e.file, roots) !== null))) continue;
    sessions++;
    const times = events.map((e) => e.ts).sort();
    const begun = times[0]!;
    stamps.push(begun, times.at(-1)!);

    const loads: Load[] = [];
    for (const e of events) {
      const unit = e.event === 'load' ? byPath.get(within(e.file, roots) ?? '') : e.event === 'skill' ? listed.get(e.skill) : undefined;
      if (!unit) continue;
      const other = e.event === 'load' && e.sha256 !== null && e.sha256 !== unit.files[0]!.sha256;
      loads.push({ unit, ts: e.ts, reason: e.event === 'load' ? loadReason(e.reason) : 'skill_invoked', other, observed: true });
    }
    for (const { unit, reason } of fallbackLoads(scan, new Set(loads.map((l) => l.unit.id)))) {
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
  const unseen =
    sessions === 0
      ? []
      : entries
          .filter((e) => byId.has(e.unitId) && !tally.has(e.unitId))
          .map((e) => ({ id: e.unitId, path: e.path, mode: e.mode }))
          .sort((a, b) => (a.path < b.path ? -1 : 1));

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
