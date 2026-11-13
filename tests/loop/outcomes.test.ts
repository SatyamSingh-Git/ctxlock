import { describe, expect, it } from 'vitest';
import type { SessionLoad, Timeline } from '../../src/collect/sessions.js';
import type { ShippedFix } from '../../src/loop/fixes.js';
import type { MissSignal } from '../../src/loop/misses.js';
import type { Sessions } from '../../src/collect/sessions.js';
import { counters, durability, type FixOutcome, numbers, outcomeOf, type Window } from '../../src/loop/outcomes.js';
import type { Unit } from '../../src/model.js';
import type { ScanResult } from '../../src/scan.js';

const ID = 'rule/.claude/rules/deps.md';
const OLD = 'a'.repeat(64);
const FIXED = 'b'.repeat(64);
const LATER = 'c'.repeat(64);
const UNIT = { id: ID, files: [{ path: '.claude/rules/deps.md', bytes: 1, sha256: LATER }] } as Unit;
const SCAN = { units: [UNIT] } as ScanResult;

const FIX: ShippedFix = {
  probe: { id: 'miss-deps' } as ShippedFix['probe'],
  unit: ID,
  commit: 'f'.repeat(40),
  shippedAt: '2026-11-01T10:00:00Z',
  unchanged: false,
  versions: [
    { commit: 'f'.repeat(40), at: '2026-11-01T10:00:00Z', file: FIXED, unit: 'sha256:fixed' },
    { commit: 'e'.repeat(40), at: '2026-11-03T10:00:00Z', file: LATER, unit: 'sha256:later' },
  ],
};

const loaded = (ts: string, sha256: string | null, observed = true): SessionLoad => ({ unit: UNIT, ts, reason: 'session_start', other: false, observed, sha256 });
const session = (id: string, ...loads: SessionLoad[]): Timeline => ({ session: id, folder: '', begun: loads[0]!.ts, last: loads.at(-1)!.ts, loads, seeable: [] });
const signal = (sessionId: string, ts: string, o: Partial<MissSignal> = {}): MissSignal => ({ session: sessionId, kind: 'correction', ts, untrusted: false, actions: [], context: [ID], turn: [], ...o });
const day = (d: number, hour = 10) => `2026-11-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;

describe('durability', () => {
  it('a fix with sessions that saw it and no signal held; one with a signal in the window missed again; one with no session in a closed window has no sessions', () => {
    const now = new Date('2026-12-15T00:00:00Z');
    const clean = [session('a', loaded(day(2), FIXED)), session('b', loaded(day(20), FIXED))];

    expect(durability(FIX, clean, [], now)).toEqual([
      { days: 7, status: 'held', sessions: 1, missed: 0 },
      { days: 30, status: 'held', sessions: 2, missed: 0 },
    ]);
    // A signal on day 20 is in the 30-day window, not the 7-day one; one in another session or with the unit out of context is not this fix's.
    const found = [signal('b', day(20, 11)), signal('a', day(2, 11), { context: [] }), signal('z', day(2, 11))];
    expect(durability(FIX, clean, found, now)).toEqual([
      { days: 7, status: 'held', sessions: 1, missed: 0 },
      { days: 30, status: 'missed again', sessions: 2, missed: 1 },
    ]);
    expect(durability(FIX, [], [], now)).toEqual([
      { days: 7, status: 'no sessions', sessions: 0, missed: 0 },
      { days: 30, status: 'no sessions', sessions: 0, missed: 0 },
    ]);
    // A signal before the session loaded the fix, or one from before the collector recorded it, is not counted.
    const early = [session('c', loaded(day(2), OLD), loaded(day(2, 12), FIXED))];
    expect(durability(FIX, early, [signal('c', day(2, 11)), signal('c', day(2, 13), { unrecorded: true })], now)[0]).toEqual({ days: 7, status: 'held', sessions: 1, missed: 0 });
    // A session that tried the fix before it was committed is not judged; a signal after the window is the next window's.
    const before = [session('pre', loaded('2026-10-31T10:00:00Z', FIXED)), session('a', loaded(day(2), FIXED))];
    expect(durability(FIX, before, [signal('a', day(9))], now)).toEqual([
      { days: 7, status: 'held', sessions: 1, missed: 0 },
      { days: 30, status: 'missed again', sessions: 1, missed: 1 },
    ]);
  });

  it('a window not yet closed is pending, with how it stands so far', () => {
    const now = new Date('2026-11-05T00:00:00Z');

    expect(durability(FIX, [session('a', loaded(day(2), FIXED))], [signal('a', day(2, 11))], now)).toEqual([
      { days: 7, status: 'pending', sessions: 1, missed: 1 },
      { days: 30, status: 'pending', sessions: 1, missed: 1 },
    ]);
  });

  it('a session on the bytes of a later edit saw the fix, one on the old bytes or unknown bytes is not judged', () => {
    const now = new Date('2026-12-15T00:00:00Z');
    const timelines = [session('later', loaded(day(4), LATER)), session('old', loaded(day(4), OLD)), session('unknown', loaded(day(4), null)), session('predicted', loaded(day(4), null, false))];
    const found = ['later', 'old', 'unknown', 'predicted'].map((s) => signal(s, day(4, 11)));

    expect(durability(FIX, timelines, found, now)[0]).toEqual({ days: 7, status: 'missed again', sessions: 1, missed: 1 });
  });

  it('windows are instants: a fix shipped at 23:30 at -05:00 on the 31st closes its 7-day window seven days later to the minute', () => {
    const fix = { ...FIX, shippedAt: '2026-10-31T23:30:00-05:00' };
    const inside = [session('a', loaded('2026-11-08T04:29:00Z', FIXED))];
    const outside = [session('a', loaded('2026-11-08T04:31:00Z', FIXED))];

    expect(durability(fix, inside, [], new Date('2026-11-08T04:29:59Z'))[0]!.status).toBe('pending');
    expect(durability(fix, inside, [], new Date('2026-11-08T04:30:00Z'))[0]).toEqual({ days: 7, status: 'held', sessions: 1, missed: 0 });
    expect(durability(fix, outside, [], new Date('2026-11-09T00:00:00Z'))[0]).toEqual({ days: 7, status: 'no sessions', sessions: 0, missed: 0 });
  });
});

describe('outcomeOf', () => {
  it("a fix's first signal is the earliest recorded one with the unit in context before it shipped, and its days to fix count from there", () => {
    const now = new Date('2026-12-15T00:00:00Z');
    const found = [signal('a', '2026-10-30T10:00:00Z', { context: [] }), signal('b', '2026-10-30T22:00:00Z'), signal('c', '2026-10-29T10:00:00Z', { unrecorded: true }), signal('d', day(5))];

    const o = outcomeOf(FIX, [], found, now, { consumers: ['payments-api'], pinnedBy: ['acme/web'] });

    expect(o).toMatchObject({ firstSignal: '2026-10-30T22:00:00Z', daysToFix: 1.5, consumers: ['payments-api'], pinnedBy: ['acme/web'] });
    expect(o.windows.map((w) => w.status)).toEqual(['no sessions', 'no sessions']);
    expect(outcomeOf(FIX, [], [], now, { consumers: [], pinnedBy: [] })).toMatchObject({ firstSignal: null, daysToFix: null });
    // A signal only after the ship is no time to fix.
    expect(outcomeOf(FIX, [], [signal('d', day(5))], now, { consumers: [], pinnedBy: [] })).toMatchObject({ firstSignal: null, daysToFix: null });
  });
});

describe('numbers', () => {
  const SESSIONS = { sessions: 12, units: [{}, {}, {}], unseen: [{}, {}] } as unknown as Sessions;
  const w = (s7: Window['status'], s30: Window['status']): Window[] => [
    { days: 7, status: s7, sessions: 1, missed: s7 === 'missed again' ? 1 : 0 },
    { days: 30, status: s30, sessions: 1, missed: s30 === 'missed again' ? 1 : 0 },
  ];
  const outcome = (o: Partial<FixOutcome>): FixOutcome => ({ fix: FIX, firstSignal: null, daysToFix: null, windows: w('pending', 'pending'), consumers: [], pinnedBy: [], ...o });

  it('the median time to fix counts only fixes with a recorded signal before them, the regression rate only judged closed windows, and durability at 30 days only judged closed 30-day windows', () => {
    const n = numbers(
      [
        outcome({ daysToFix: 1, windows: w('held', 'held') }),
        outcome({ daysToFix: 3, windows: w('held', 'missed again') }),
        outcome({ daysToFix: 10, windows: w('missed again', 'pending') }),
        outcome({ windows: w('no sessions', 'no sessions') }),
        outcome({ windows: w('pending', 'pending') }),
      ],
      SESSIONS,
    );

    expect(n).toMatchObject({ medianDaysToFix: 3, timed: 3, regressed: 2, judged7: 3, held30: 1, judged30: 2, neverLoaded: 2, loadable: 5, sessions: 12 });
    // A probe that fails today regresses a fix whose windows say nothing yet; one that holds makes it judged.
    expect(numbers([outcome({ probe: 'fails' }), outcome({ probe: 'holds' })], SESSIONS)).toMatchObject({ regressed: 1, judged7: 2 });
    expect(numbers([], SESSIONS)).toMatchObject({ medianDaysToFix: null, timed: 0, regressed: 0, judged7: 0, reached: 0 });
    const even = [outcome({ daysToFix: 1, windows: w('held', 'held') }), outcome({ daysToFix: 4, windows: w('held', 'held') }), outcome({ windows: w('held', 'missed again') })];
    expect(numbers(even, SESSIONS)).toMatchObject({ medianDaysToFix: 2.5, held30: 2, judged30: 3 });
  });

  it('consumers reached sum each fix\'s declared consumers and the repositories whose lock pins it at a fixed version', () => {
    expect(numbers([outcome({ consumers: ['payments-api'], pinnedBy: ['acme/web', 'acme/docs'] }), outcome({ consumers: ['payments-api'] })], SESSIONS).reached).toBe(4);
  });
});

describe('counters', () => {
  it('each version of a unit counts helpful and harmful sessions, a session with only untrusted signals counts half, and an unrecorded signal counts for neither', () => {
    const timelines = [
      session('clean', loaded(day(1), OLD)),
      session('hit', loaded(day(1), OLD)),
      session('web', loaded(day(1), OLD)),
      session('early', loaded(day(1), OLD)),
      session('now', loaded(day(5), LATER)),
    ];
    const found = [signal('hit', day(1, 11)), signal('hit', day(1, 12), { untrusted: true }), signal('web', day(1, 11), { untrusted: true }), signal('early', day(1, 11), { unrecorded: true })];

    const old = counters(timelines, found, SCAN, []).find((c) => c.version === OLD);

    // early's signal came before the collector recorded it: the session is neither.
    expect(old).toEqual({ unit: ID, version: OLD, today: false, fixed: false, helpful: 1, harmful: 1.5 });
  });

  it("the version loaded today and a fix's version are marked", () => {
    const timelines = [session('a', loaded(day(5), LATER)), session('b', loaded(day(2), FIXED)), session('c', loaded(day(1), null, false)), session('d', loaded(day(1), OLD))];

    expect(counters(timelines, [], SCAN, [FIX]).map(({ version, today, fixed }) => [version, today, fixed])).toEqual([
      [LATER, true, true],
      [OLD, false, false],
      [FIXED, false, true],
      [null, false, false],
    ]);
    // A skill call before the file load has no digest; the session's version is the file load's.
    const called = [session('e', loaded(day(1), null), loaded(day(1, 11), OLD))];
    expect(counters(called, [], SCAN, [])).toEqual([{ unit: ID, version: OLD, today: false, fixed: false, helpful: 1, harmful: 0 }]);
  });
});
