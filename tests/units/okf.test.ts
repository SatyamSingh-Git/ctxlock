import { describe, expect, it } from 'vitest';
import { okfTrust } from '../../src/units/okf.js';

describe('okfTrust', () => {
  it('the suite runs in UTC, as CI does, whatever the machine', () => {
    expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).toBe(0);
    expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).toBe(0);
  });

  it('verified as a mapping or a list gives the latest date, and stale_after is due the day before its instant', () => {
    expect(okfTrust({ verified: { by: 'human:a', at: '2026-06-25T09:00:00Z' } })).toEqual({ verifiedAt: '2026-06-25' });
    // 23:30 at -02:00 is 01:30 the next day in UTC.
    expect(okfTrust({ verified: [{ by: 'human:a', at: '2026-06-25T09:00:00Z' }, { by: 'human:b', at: '2026-07-01T23:30:00-02:00' }] })).toEqual({ verifiedAt: '2026-07-02' });
    expect(okfTrust({ verified: [{ by: 'human:b', at: '2026-07-01T23:30:00-02:00' }, { by: 'human:a', at: '2026-06-25T09:00:00Z' }] })).toEqual({ verifiedAt: '2026-07-02' });
    expect(okfTrust({ stale_after: '2026-12-31T00:00:00Z' })).toEqual({ staleAfter: '2026-12-30' });
    expect(okfTrust({ stale_after: '2026-12-31T12:00:00Z' })).toEqual({ staleAfter: '2026-12-31' });
  });

  it('stale_after is due on the local day before its instant, so ahead of UTC it is never flagged early', () => {
    const zone = process.env.TZ;
    const due = (tz: string, stale_after: string) => {
      process.env.TZ = tz;
      return okfTrust({ stale_after }).staleAfter;
    };
    try {
      // 2026-12-01T00:00Z is 09:00 on 1 December in Tokyo. Due by 30 November, L9 would flag it from
      // Tokyo's 1 December, 15:00Z the day before: due by 1 December, it is flagged from 2 December.
      expect(due('Asia/Tokyo', '2026-12-01T00:00:00Z')).toBe('2026-12-01');
      // In New York the instant falls on 30 November, as in UTC.
      expect(due('America/New_York', '2026-12-01T00:00:00Z')).toBe('2026-11-30');
      expect(due('UTC', '2026-12-01T00:00:00Z')).toBe('2026-11-30');
      process.env.TZ = 'Asia/Tokyo';
      // 23:30 at -02:00 is 10:30 the next day in Tokyo.
      expect(okfTrust({ verified: { by: 'human:a', at: '2026-07-01T23:30:00-02:00' } })).toEqual({ verifiedAt: '2026-07-02' });
      expect(okfTrust({ verified: { by: 'human:a', at: '2026-07-01T10:00:00Z' } })).toEqual({ verifiedAt: '2026-07-01' });
      process.env.TZ = 'America/New_York';
      expect(okfTrust({ verified: { by: 'human:a', at: '2026-07-02T01:30:00Z' } })).toEqual({ verifiedAt: '2026-07-01' });
    } finally {
      process.env.TZ = zone;
    }
  });

  it('a time without an offset, a verified entry without one, or no frontmatter gives nothing', () => {
    expect(okfTrust({ stale_after: '2026-12-31', verified: { by: 'human:a', at: '2026-06-25' } })).toEqual({});
    expect(okfTrust({ verified: [{ by: 'human:a' }, null] })).toEqual({});
    expect(okfTrust(null)).toEqual({});
  });
});
