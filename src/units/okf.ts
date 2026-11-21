// OKF 0.2 times are ISO 8601 with an explicit offset (SPEC.md, after #323).
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const isInstant = (value: unknown): value is string => typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value));

// Each timestamp an OKF concept's frontmatter holds, by where it is. A bare verified mapping is a list of one.
export function okfTimes(frontmatter: Record<string, unknown>): Array<[string, unknown]> {
  const times: Array<[string, unknown]> = [];
  if ('stale_after' in frontmatter) times.push(['stale_after', frontmatter.stale_after]);
  const generated = frontmatter.generated as { at?: unknown } | null | undefined;
  if (generated && typeof generated === 'object' && 'at' in generated) times.push(['generated.at', generated.at]);
  const verified = frontmatter.verified;
  const list = Array.isArray(verified) ? verified : verified && typeof verified === 'object' ? [verified] : [];
  list.forEach((v: { at?: unknown } | null, i) => {
    if (v && typeof v === 'object' && 'at' in v) times.push([Array.isArray(verified) ? `verified[${i}].at` : 'verified.at', v.at]);
  });
  return times;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// D103: OKF's trust times as ctxlock's dates. stale_after is the instant a concept turns stale, and
// stale-after the last day it is still good, so the day before; one later in a day is flagged a day late.
export function okfTrust(frontmatter: Record<string, unknown> | null): { verifiedAt?: string; staleAfter?: string } {
  if (!frontmatter) return {};
  const times = okfTimes(frontmatter);
  const verified = times.filter(([where, at]) => where.startsWith('verified') && isInstant(at)).map(([, at]) => Date.parse(at as string));
  const stale = frontmatter.stale_after;
  return {
    ...(verified.length > 0 && { verifiedAt: utcDay(Math.max(...verified)) }),
    ...(isInstant(stale) && { staleAfter: utcDay(Date.parse(stale) - 1) }),
  };
}
