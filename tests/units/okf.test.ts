import { describe, expect, it } from 'vitest';
import { okfTrust } from '../../src/units/okf.js';

describe('okfTrust', () => {
  it('verified as a mapping or a list gives the latest date, and stale_after is due the day before its instant', () => {
    expect(okfTrust({ verified: { by: 'human:a', at: '2026-06-25T09:00:00Z' } })).toEqual({ verifiedAt: '2026-06-25' });
    // 23:30 at -02:00 is 01:30 the next day in UTC.
    expect(okfTrust({ verified: [{ by: 'human:a', at: '2026-06-25T09:00:00Z' }, { by: 'human:b', at: '2026-07-01T23:30:00-02:00' }] })).toEqual({ verifiedAt: '2026-07-02' });
    expect(okfTrust({ verified: [{ by: 'human:b', at: '2026-07-01T23:30:00-02:00' }, { by: 'human:a', at: '2026-06-25T09:00:00Z' }] })).toEqual({ verifiedAt: '2026-07-02' });
    expect(okfTrust({ stale_after: '2026-12-31T00:00:00Z' })).toEqual({ staleAfter: '2026-12-30' });
    expect(okfTrust({ stale_after: '2026-12-31T12:00:00Z' })).toEqual({ staleAfter: '2026-12-31' });
  });

  it('a time without an offset, a verified entry without one, or no frontmatter gives nothing', () => {
    expect(okfTrust({ stale_after: '2026-12-31', verified: { by: 'human:a', at: '2026-06-25' } })).toEqual({});
    expect(okfTrust({ verified: [{ by: 'human:a' }, null] })).toEqual({});
    expect(okfTrust(null)).toEqual({});
  });
});
