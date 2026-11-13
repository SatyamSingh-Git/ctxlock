import { describe, expect, it } from 'vitest';
import type { ShippedFix } from '../../src/loop/fixes.js';
import type { Outcomes } from '../../src/loop/outcomes.js';
import { renderOutcomes } from '../../src/report/outcomes.js';

const ID = 'rule/.claude/rules/deps.md';
const FIX = {
  probe: { id: 'miss-deps' },
  unit: ID,
  commit: '1a2b3c4d5e6f'.padEnd(40, '0'),
  shippedAt: '2026-11-02T10:00:00Z',
  unchanged: false,
  versions: [{ commit: '1a2b3c4d5e6f'.padEnd(40, '0'), at: '2026-11-02T10:00:00Z', file: 'b'.repeat(64), unit: 'sha256:x' }],
} as unknown as ShippedFix;

const OUTCOMES: Outcomes = {
  sessions: 12,
  untranscribed: 0,
  git: true,
  fixes: [
    {
      fix: FIX,
      firstSignal: '2026-11-01T10:00:00Z',
      daysToFix: 1,
      windows: [
        { days: 7, status: 'held', sessions: 2, missed: 0 },
        { days: 30, status: 'pending', sessions: 3, missed: 1 },
      ],
      consumers: ['payments-api'],
      pinnedBy: ['acme/web'],
    },
  ],
  orphans: ['miss-rule-.claude-rules-gone.md-00000000'],
  counters: [
    { unit: ID, version: 'b'.repeat(64), today: true, fixed: true, helpful: 3, harmful: 0.5 },
    { unit: ID, version: 'a'.repeat(64), today: false, fixed: false, helpful: 0, harmful: 2 },
    { unit: ID, version: null, today: false, fixed: false, helpful: 1, harmful: 0 },
  ],
  numbers: { fixes: 1, medianDaysToFix: 1, timed: 1, regressed: 0, judged: 1, held30: 0, judged30: 0, reached: 2, neverLoaded: 4, loadable: 9, sessions: 12 },
};

describe('renderOutcomes', () => {
  it('text gives each fix\'s windows, the counters and the numbers, and json carries them', () => {
    const text = renderOutcomes(OUTCOMES, 'text');

    expect(text).toContain('ctxlock outcomes · 12 sessions recorded\n');
    expect(text).toContain(`\nShipped fixes:\n  ${ID}  shipped 2026-11-02 in 1a2b3c4, 1.0 days after its first signal\n`);
    expect(text).toContain('\n    7 days   held, in 2 sessions that loaded the fix\n');
    expect(text).toContain('\n    30 days  pending: so far 3 sessions, 1 with a signal\n');
    expect(text).toContain('\n    Reached: payments-api; pinned by acme/web\n');
    expect(text).toContain('\nProbes whose unit is gone:\n  miss-rule-.claude-rules-gone.md-00000000\n');
    // Columns as table pads them: the version column is as wide as "unknown bytes".
    expect(text).toContain(`\nHelpful and harmful, by the version loaded:\n  ${ID}  bbbbbbbbbbbb   today, a fix  helpful 3  harmful 0.5\n`);
    expect(text).toContain(`\n${' '.repeat(30)}aaaaaaaaaaaa${' '.repeat(17)}helpful 0  harmful 2\n`);
    expect(text).toContain(`\n${' '.repeat(30)}unknown bytes${' '.repeat(16)}helpful 1  harmful 0\n`);
    expect(text).toContain('Harmful counts sessions with a signal while the unit was in context, not proven harm');
    expect(text).toContain('\nThe numbers:\n  Median time to fix     1.0 days, over 1 fix\n  Regression rate        0 of 1 fix judged\n  Durability at 30 days  - (no 30-day window has closed and been judged)\n  Fixes × consumers      2, over 1 fix\n  Never loaded           4 of 9 units, in 12 sessions; ctxlock loads lists them\n');

    const json = JSON.parse(renderOutcomes(OUTCOMES, 'json'));
    expect(json).toMatchObject({ sessions: 12, git: true, numbers: { reached: 2 }, counters: [{ helpful: 3 }, {}, {}] });
    expect(json.fixes[0]).toMatchObject({ unit: ID, probe: 'miss-deps', commit: FIX.commit, shippedAt: FIX.shippedAt, daysToFix: 1, windows: [{ status: 'held' }, { status: 'pending' }] });
  });

  it('a time under a day reads in hours or minutes, and a table with no marked version has no empty column', () => {
    const quick = { ...OUTCOMES.fixes[0]!, daysToFix: 2 / 1440 };
    const text = renderOutcomes({ ...OUTCOMES, fixes: [quick], numbers: { ...OUTCOMES.numbers, medianDaysToFix: 0.25 }, counters: [OUTCOMES.counters[2]!] }, 'text');

    expect(text).toContain(', 2 minutes after its first signal\n');
    expect(text).toContain('\n  Median time to fix     6.0 hours, over 1 fix\n');
    expect(text).toContain(`\n  ${ID}  unknown bytes  helpful 1  harmful 0\n`);
  });

  it('with no fix it says how a fix ships, and outside git that none can be found', () => {
    const none = { ...OUTCOMES, fixes: [], orphans: [] };

    expect(renderOutcomes(none, 'text')).toContain('\nNo shipped fix: a fix ships when the probe ctxlock diagnose wrote for it is committed.\n');
    expect(renderOutcomes({ ...none, numbers: { ...OUTCOMES.numbers, judged: 0 } }, 'text')).toContain("\n  Regression rate        - (no fix's window has closed with sessions in it)\n");
    expect(renderOutcomes({ ...none, git: false }, 'text')).toContain('\nNot a git repository, so no fix can be found shipped.\n');
    expect(renderOutcomes({ ...none, counters: [] }, 'text')).toContain('\nHelpful and harmful: no recorded session loaded a unit.\n');
  });
});
