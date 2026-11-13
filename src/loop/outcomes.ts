import type { Sessions, Timeline } from '../collect/sessions.js';
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

export interface FixOutcome {
  fix: ShippedFix;
  firstSignal: string | null;
  daysToFix: number | null;
  windows: Window[];
  // Declared consumers of the unit, and the repositories whose lock pins one of the fix's versions.
  consumers: string[];
  pinnedBy: string[];
  // With --verify: the fix's probe run on the repository as it is.
  probe?: 'holds' | 'fails' | 'inconclusive';
}

// D93: time to fix counts from the earliest recorded signal with the unit in context, before it shipped.
export function outcomeOf(fix: ShippedFix, timelines: Timeline[], found: MissSignal[], now: Date, reach: { consumers: string[]; pinnedBy: string[] }): FixOutcome {
  const shipped = time(fix.shippedAt);
  const before = against(found, fix.unit).filter((s) => time(s.ts) <= shipped);
  const first = before.reduce<MissSignal | null>((a, s) => (a === null || time(s.ts) < time(a.ts) ? s : a), null);
  return {
    fix,
    firstSignal: first?.ts ?? null,
    daysToFix: first ? (shipped - time(first.ts)) / DAY : null,
    windows: durability(fix, timelines, found, now),
    ...reach,
  };
}

export interface Numbers {
  fixes: number;
  medianDaysToFix: number | null;
  timed: number;
  regressed: number;
  judged7: number;
  held30: number;
  judged30: number;
  reached: number;
  neverLoaded: number;
  loadable: number;
  sessions: number;
}

const judged = (w: Window | undefined) => w?.status === 'held' || w?.status === 'missed again';

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// D93: every number comes with what it was counted over, and nothing judges a window still open.
export function numbers(outcomes: FixOutcome[], sessions: Sessions): Numbers {
  const days = outcomes.flatMap((o) => (o.daysToFix === null ? [] : [o.daysToFix]));
  // A fix is judged once its 7-day window closed with sessions in it, or its probe was run again.
  const judged7 = outcomes.filter((o) => judged(o.windows.find((w) => w.days === 7)) || o.probe === 'holds' || o.probe === 'fails');
  const regressed = judged7.filter((o) => o.probe === 'fails' || o.windows.some((w) => w.status === 'missed again'));
  const thirty = outcomes.map((o) => o.windows.find((w) => w.days === 30)).filter(judged);
  return {
    fixes: outcomes.length,
    medianDaysToFix: median(days),
    timed: days.length,
    regressed: regressed.length,
    judged7: judged7.length,
    held30: thirty.filter((w) => w!.status === 'held').length,
    judged30: thirty.length,
    reached: outcomes.reduce((n, o) => n + o.consumers.length + o.pinnedBy.length, 0),
    neverLoaded: sessions.unseen.length,
    loadable: sessions.units.length + sessions.unseen.length,
    sessions: sessions.sessions,
  };
}

export interface Outcomes {
  sessions: number;
  git: boolean;
  fixes: FixOutcome[];
  orphans: string[];
  counters: Counter[];
  numbers: Numbers;
}
