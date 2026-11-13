import type { Timeline } from '../collect/sessions.js';
import type { ScanResult } from '../scan.js';
import type { ShippedFix } from './fixes.js';
import type { MissSignal } from './misses.js';

export type WindowStatus = 'held' | 'missed again' | 'no sessions' | 'pending';

export interface Window {
  days: 7 | 30;
  status: WindowStatus;
  // Sessions that saw the fix in the window, and those of them with a signal.
  sessions: number;
  missed: number;
}

const DAY = 24 * 60 * 60 * 1000;
const time = (ts: string) => Date.parse(ts);

// The signals that count against a unit: in context, and from a session the collector was recording.
const against = (found: MissSignal[], unit: string) => found.filter((s) => !s.unrecorded && s.context.includes(unit));

// D91: judged from the sessions that loaded one of the fix's versions, from when they loaded it. Windows
// are instants, so a commit's time zone and a month's end change nothing.
export function durability(fix: ShippedFix, timelines: Timeline[], found: MissSignal[], now: Date): Window[] {
  const fixed = new Set(fix.versions.map((v) => v.file));
  const shipped = time(fix.shippedAt);
  const signals = against(found, fix.unit);
  const saw = timelines.flatMap((t) => {
    const load = t.loads.find((l) => l.unit.id === fix.unit && l.sha256 !== null && fixed.has(l.sha256));
    return load ? [{ session: t.session, at: time(load.ts) }] : [];
  });
  return ([7, 30] as const).map((days) => {
    const end = shipped + days * DAY;
    const inside = saw.filter((s) => s.at > shipped && s.at <= end);
    const missed = inside.filter((s) => signals.some((g) => g.session === s.session && time(g.ts) > s.at && time(g.ts) <= end)).length;
    const status: WindowStatus = now.getTime() < end ? 'pending' : inside.length === 0 ? 'no sessions' : missed > 0 ? 'missed again' : 'held';
    return { days, status, sessions: inside.length, missed };
  });
}

export interface Counter {
  unit: string;
  // The loaded file's digest; null when no load in the session had one.
  version: string | null;
  today: boolean;
  fixed: boolean;
  helpful: number;
  harmful: number;
}

// D92: ACE's helpful and harmful, applied to exposure. Harmful means in context at a signal, not proven
// harm; a session whose every such signal followed web or MCP content counts half, as misses weighs it.
export function counters(timelines: Timeline[], found: MissSignal[], scan: ScanResult, fixes: ShippedFix[]): Counter[] {
  const units = new Map(scan.units.map((u) => [u.id, u]));
  const rows = new Map<string, Counter>();
  for (const t of timelines) {
    for (const id of new Set(t.loads.map((l) => l.unit.id))) {
      const version = t.loads.find((l) => l.unit.id === id && l.sha256 !== null)?.sha256 ?? null;
      const key = `${id}\0${version}`;
      const row = rows.get(key) ?? {
        unit: id,
        version,
        today: version !== null && version === units.get(id)?.files[0]?.sha256,
        fixed: version !== null && fixes.some((f) => f.unit === id && f.versions.some((v) => v.file === version)),
        helpful: 0,
        harmful: 0,
      };
      const signals = against(found, id).filter((s) => s.session === t.session);
      const early = found.some((s) => s.session === t.session && s.unrecorded && s.context.includes(id));
      if (signals.length) row.harmful += signals.every((s) => s.untrusted) ? 0.5 : 1;
      else if (!early) row.helpful++;
      rows.set(key, row);
    }
  }
  const rank = (c: Counter) => (c.today ? 0 : c.version === null ? 2 : 1);
  return [...rows.values()].sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : rank(a) - rank(b) || ((a.version ?? '') < (b.version ?? '') ? -1 : 1)));
}
