import { type ArmResult, type ProbeOutcome, runProbes } from '../eval/eval.js';
import { loadProbes, type Probe } from '../eval/probes.js';
import type { Unit } from '../model.js';
import { fsReader } from '../repo/reader.js';
import { type ScanResult, scanRepo } from '../scan.js';

export type Check = 'holds' | 'fails' | 'inconclusive' | 'no probes';

export type VerifyOptions = { runs: number; maxRuns: number; maxMinutes: number; model: string; claude: string[]; workdir: string };

export interface UnitCheck {
  unit: Unit;
  check: Check;
  probes: ProbeOutcome[];
  // For a unit that holds: what to set in ctxlock.yaml.
  next?: { verifiedAt: string; staleAfter: string };
}

// D94: a failed valid run fails the unit, whatever else was cut short; holding needs every probe to pass
// in at least 2 valid runs.
export function judgeHead(arms: Array<ArmResult | null>): Exclude<Check, 'no probes'> {
  if (arms.some((a) => a !== null && a.passed < a.valid)) return 'fails';
  return arms.every((a) => a !== null && a.valid >= 2) ? 'holds' : 'inconclusive';
}

// As L9 reads it: a stale-after before today, in local time.
export const dueUnits = (scan: ScanResult, today: string) =>
  scan.units.filter((u) => {
    const due = scan.registry.units[u.path]?.staleAfter;
    return due !== undefined && due < today;
  });

const DAY = 24 * 60 * 60 * 1000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

// The unit's own interval carried forward, or 90 days when it has none.
export function nextDates(verifiedAt: string | undefined, staleAfter: string | undefined, today: string): { verifiedAt: string; staleAfter: string } {
  const own = verifiedAt !== undefined && staleAfter !== undefined ? Math.round((utc(staleAfter) - utc(verifiedAt)) / DAY) : 0;
  const days = own > 0 ? own : 90;
  return { verifiedAt: today, staleAfter: new Date(utc(today) + days * DAY).toISOString().slice(0, 10) };
}

// Probes run on the repository as it is, head side only, as eval runs them. Without CLAUDE.local.md,
// as eval and diagnose run.
export async function headRuns(root: string, probes: Probe[], opts: VerifyOptions): Promise<{ outcomes: ProbeOutcome[]; runs: number }> {
  if (!probes.length) return { outcomes: [], runs: 0 };
  const reader = fsReader(root, { local: false });
  const scan = await scanRepo(reader);
  const ran = await runProbes(
    { base: reader, head: reader },
    { base: scan, head: scan },
    probes.map((probe) => ({ probe, source: 'base', changedInHead: false, selectedFor: 'verify' })),
    { ...opts, cacheDir: null, ctxlockVersion: '', keepRuns: false, trees: { base: null, head: null }, arms: ['head'] },
  );
  return { outcomes: ran.outcomes, runs: ran.totals.runs };
}

export async function verifyProbes(root: string, scan: ScanResult, units: Unit[], today: string, opts: VerifyOptions): Promise<{ checks: UnitCheck[]; runs: number }> {
  const ids = new Set(units.map((u) => u.id));
  const probes = (await loadProbes(fsReader(root, { local: false }))).filter((p) => ids.has(p.unit));
  const { outcomes, runs } = await headRuns(root, probes, opts);
  const checks = units.map((unit): UnitCheck => {
    const own = outcomes.filter((o) => o.probe.unit === unit.id);
    if (!own.length) return { unit, check: 'no probes', probes: [] };
    const check = judgeHead(own.map((o) => o.head));
    const entry = scan.registry.units[unit.path];
    return { unit, check, probes: own, ...(check === 'holds' && { next: nextDates(entry?.verifiedAt, entry?.staleAfter, today) }) };
  });
  return { checks, runs };
}
