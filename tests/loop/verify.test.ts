import { describe, expect, it } from 'vitest';
import type { ArmResult } from '../../src/eval/eval.js';
import { dueUnits, judgeHead, nextDates } from '../../src/loop/verify.js';
import { scanRepo } from '../../src/scan.js';
import { memReader } from '../helpers/mem-reader.js';

const arm = (passed: number, valid: number): ArmResult => ({
  passed, valid, errors: [], cached: 0, interval: null, models: [], inputTokens: null, turns: null, durationMs: null, costUsd: 0, targetLoaded: { observed: 0, predicted: 0 },
});

describe('judgeHead', () => {
  it('holds only when every probe passed in at least 2 valid runs, fails on any failed valid run, and is inconclusive otherwise', () => {
    expect(judgeHead([arm(3, 3), arm(2, 2)])).toBe('holds');
    expect(judgeHead([arm(3, 3), arm(2, 3)])).toBe('fails');
    // A failure counts though another probe was cut short.
    expect(judgeHead([arm(0, 1), null])).toBe('fails');
    expect(judgeHead([arm(3, 3), arm(1, 1)])).toBe('inconclusive');
    expect(judgeHead([arm(3, 3), null])).toBe('inconclusive');
  });
});

describe('nextDates', () => {
  it("keeps the unit's own interval, or 90 days when it has none", () => {
    expect(nextDates('2026-08-01', '2026-11-01', '2026-11-13')).toEqual({ verifiedAt: '2026-11-13', staleAfter: '2027-02-13' });
    expect(nextDates(undefined, '2026-11-01', '2026-12-20')).toEqual({ verifiedAt: '2026-12-20', staleAfter: '2027-03-20' });
    expect(nextDates('2026-11-01', undefined, '2026-11-13')).toEqual({ verifiedAt: '2026-11-13', staleAfter: '2027-02-11' });
  });
});

describe('dueUnits', () => {
  it('are those whose stale-after is before today', async () => {
    const scan = await scanRepo(
      memReader({
        '.claude/rules/a.md': 'A.\n',
        '.claude/rules/b.md': 'B.\n',
        '.claude/rules/c.md': 'C.\n',
        'ctxlock.yaml': 'version: 1\nunits:\n  .claude/rules/a.md:\n    stale-after: 2026-11-12\n  .claude/rules/b.md:\n    stale-after: 2026-11-13\n',
      }),
    );

    expect(dueUnits(scan, '2026-11-13').map((u) => u.id)).toEqual(['rule/.claude/rules/a.md']);
  });
});
