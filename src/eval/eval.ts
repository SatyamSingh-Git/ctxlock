import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { diffScans } from '../diff.js';
import { fsReader, gitReader } from '../repo/reader.js';
import { type ScanResult, scanRepo } from '../scan.js';
import { sha256Hex } from '../units/digest.js';
import { type Transcript, claudeVersion as readVersion, runClaude } from './claude.js';
import { type LoadRecord, joinLoads } from './loads.js';
import { type Probe, ProbeError, grade, loadProbes } from './probes.js';
import { ancestorContext, changedSince, materialize, snapshot } from './workspace.js';

const exec = promisify(execFile);

export interface EvalOptions {
  root: string;
  base: string;
  head?: string;
  runs: number;
  maxRuns: number;
  maxMinutes: number;
  model: string;
  claude: string[];
  workdir: string;
  cacheDir: string | null;
  all: boolean;
  keepRuns: boolean;
  now?: () => number;
}

export interface ArmResult {
  passed: number;
  valid: number;
  errors: string[];
  cached: number;
  // 95% Wilson interval of passed/valid; null when no run was valid.
  interval: [number, number] | null;
  models: string[];
  // Medians over valid runs.
  inputTokens: number | null;
  turns: number | null;
  durationMs: number | null;
  costUsd: number;
  targetLoaded: { observed: number; predicted: number };
}

export type ProbeStatus = 'improved' | 'regressed' | 'unchanged' | 'inconclusive' | 'not-run';

export interface ProbeOutcome {
  probe: Probe;
  source: 'base' | 'head';
  changedInHead: boolean;
  base: ArmResult | null;
  head: ArmResult | null;
  status: ProbeStatus;
  reason?: string;
}

export interface EvalResult {
  harness: 'claude-code';
  model: string | null;
  // null when no probe needed a run, so Claude Code was never asked.
  claudeVersion: string | null;
  runsPerArm: number;
  changedUnits: string[];
  outcomes: ProbeOutcome[];
  stripped: string[];
  gateFailures: string[];
  // Probe files in the head that could not be used; the base's probes ran regardless.
  headProbeErrors: string[];
  totals: { runs: number; cachedRuns: number; wallMs: number; costUsd: number; utilizationBefore: number | null; utilizationAfter: number | null };
}

export class EvalError extends Error {}

interface RunRecord {
  passed: boolean;
  error: string | null;
  model: string | null;
  inputTokens: number;
  turns: number;
  durationMs: number;
  costUsd: number;
  loads: LoadRecord[];
}

type ArmName = 'base' | 'head';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function wilson(passed: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.96;
  const p = passed / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function summarise(probe: Probe, records: RunRecord[], cached: number): ArmResult {
  const valid = records.filter((r) => r.error === null);
  const passed = valid.filter((r) => r.passed).length;
  const target = (r: RunRecord) => r.loads.filter((l) => l.unit_id === probe.unit);
  return {
    passed,
    valid: valid.length,
    errors: records.flatMap((r) => (r.error === null ? [] : [r.error])),
    cached,
    interval: wilson(passed, valid.length),
    models: [...new Set(records.flatMap((r) => (r.model ? [r.model] : [])))],
    inputTokens: median(valid.map((r) => r.inputTokens)),
    turns: median(valid.map((r) => r.turns)),
    durationMs: median(valid.map((r) => r.durationMs)),
    costUsd: records.slice(cached).reduce((sum, r) => sum + r.costUsd, 0),
    targetLoaded: {
      observed: valid.filter((r) => target(r).some((l) => l.observed)).length,
      predicted: valid.filter((r) => target(r).length > 0 && !target(r).some((l) => l.observed)).length,
    },
  };
}

export function status(base: ArmResult | null, head: ArmResult | null): ProbeStatus {
  if (!base || !head || base.valid < 2 || head.valid < 2) return 'inconclusive';
  const d = head.passed / head.valid - base.passed / base.valid;
  return d >= 0.5 ? 'improved' : d <= -0.5 ? 'regressed' : 'unchanged';
}

// The strongest result 3 runs per arm can give: every base run passed and no head run did, a
// one-sided Fisher p of 0.05 at 3 against 3. Head-only probes never gate: the pull request wrote them.
// A probe the time budget cut short is inconclusive, and never gates.
const gated = (o: ProbeOutcome) =>
  o.source === 'base' && o.status === 'regressed' && o.base!.valid >= 3 && o.head!.valid >= 3 && o.base!.passed === o.base!.valid && o.head!.passed === 0;

const treeOf = async (root: string, ref: string) => (await exec('git', ['-C', root, 'rev-parse', `${ref}^{tree}`])).stdout.trim();

export async function runEval(opts: EvalOptions): Promise<EvalResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const readers = { base: await gitReader(opts.root, opts.base), head: opts.head ? await gitReader(opts.root, opts.head) : fsReader(opts.root) };
  const base = await scanRepo(readers.base);
  // The head is judged with the base's settings, as diff does (D30).
  const head = await scanRepo(readers.head, { settings: base.registry });
  const scans: Record<ArmName, ScanResult> = { base, head };
  const changedUnits = diffScans(base, head).changes.map((c) => c.id);

  // A probe both sides define keeps the base's definition, so a pull request cannot rewrite its judge.
  const baseProbes = await loadProbes(readers.base);
  // The head's own probe files are the pull request's to break. That is reported, and the base's
  // probes still run; stopping the check would also stop the gate that judges the pull request.
  const headProbeErrors: string[] = [];
  let headLoaded: Probe[] = [];
  try {
    headLoaded = await loadProbes(readers.head);
  } catch (err) {
    if (!(err instanceof ProbeError)) throw err;
    headProbeErrors.push(err.message);
  }
  const headProbes = new Map(headLoaded.map((p) => [p.id, p]));
  const unitIds = new Set([...base.units, ...head.units].map((u) => u.id));
  const unknownUnit = (probe: Probe) => `${probe.file}: probe ${probe.id}: unit ${probe.unit} is in neither the base nor the head`;
  for (const probe of baseProbes) if (!unitIds.has(probe.unit)) throw new EvalError(unknownUnit(probe));
  const headOnly = [...headProbes.values()].filter((p) => !baseProbes.some((b) => b.id === p.id));
  for (const probe of headOnly) if (!unitIds.has(probe.unit)) headProbeErrors.push(unknownUnit(probe));
  const candidates = [
    ...baseProbes.map((probe) => ({ probe, source: 'base' as const, changedInHead: headProbes.has(probe.id) && headProbes.get(probe.id)!.hash !== probe.hash })),
    ...headOnly.filter((p) => unitIds.has(p.unit)).map((probe) => ({ probe, source: 'head' as const, changedInHead: false })),
  ];
  const selected = candidates.filter((c) => opts.all || changedUnits.includes(c.probe.unit));

  const result: EvalResult = {
    harness: 'claude-code', model: null, claudeVersion: null, runsPerArm: opts.runs, changedUnits, outcomes: [], stripped: [], gateFailures: [], headProbeErrors,
    totals: { runs: 0, cachedRuns: 0, wallMs: 0, costUsd: 0, utilizationBefore: null, utilizationAfter: null },
  };
  if (selected.length === 0) {
    result.totals.wallMs = now() - started;
    return result;
  }

  mkdirSync(opts.workdir, { recursive: true });
  const runRoot = mkdtempSync(join(opts.workdir, 'ctxlock-run-'));
  const dirs: Record<ArmName, string> = { base: join(runRoot, 'base'), head: join(runRoot, 'head') };
  try {
    for (const dir of Object.values(dirs)) {
      const [found] = ancestorContext(dir);
      if (found) throw new EvalError(`${found} is above the run folder and would load into every run; pass --workdir <a folder outside it>`);
    }
    const version = await readVersion(opts.claude);
    result.claudeVersion = version;
    const trees: Record<ArmName, string | null> = { base: await treeOf(opts.root, opts.base), head: opts.head ? await treeOf(opts.root, opts.head) : null };
    const before: Partial<Record<ArmName, ReturnType<typeof snapshot>>> = {};
    for (const arm of ['base', 'head'] as const) {
      const m = await materialize(readers[arm], dirs[arm]);
      result.stripped.push(...m.stripped);
      before[arm] = snapshot(dirs[arm]);
    }
    result.stripped = [...new Set(result.stripped)].sort();

    // Only arms read from a git ref are cached, keyed by the whole tree: what the agent does can
    // depend on any file, such as package.json naming the package manager.
    const cacheKey = (arm: ArmName, probe: Probe) => {
      const tree = trees[arm];
      return tree === null || opts.cacheDir === null ? null : sha256Hex(JSON.stringify([tree, probe.hash, opts.model, version]));
    };
    const readCache = (key: string | null): RunRecord[] => {
      if (key === null || opts.cacheDir === null) return [];
      const file = join(opts.cacheDir, `${key}.json`);
      if (!existsSync(file)) return [];
      // A run that failed (logged out, rate-limited) says nothing about the context, so it is never reused.
      return (JSON.parse(readFileSync(file, 'utf8')) as { records: RunRecord[] }).records.filter((r) => r.error === null).slice(0, opts.runs);
    };

    let planned = 0;
    let overBudget = false;
    const plans = selected.map((c) => {
      const keys = { base: cacheKey('base', c.probe), head: cacheKey('head', c.probe) };
      const records = { base: readCache(keys.base), head: readCache(keys.head) };
      const cost = 2 * opts.runs - records.base.length - records.head.length;
      if (!overBudget && planned + cost <= opts.maxRuns) planned += cost;
      else overBudget = true;
      return { ...c, keys, records, cached: { base: records.base.length, head: records.head.length }, runnable: !overBudget, started: false, complete: false };
    });

    let n = 0;
    const elapsed = () => now() - started > opts.maxMinutes * 60_000;
    // Once the time is up no run starts, but later probes the cache already holds still count.
    for (const plan of plans) {
      if (!plan.runnable) break;
      for (let i = 0; i < opts.runs; i++) {
        for (const arm of ['base', 'head'] as const) {
          if (plan.records[arm].length > i) continue;
          if (elapsed()) break;
          plan.started = true;
          const t: Transcript = await runClaude({ dir: dirs[arm], scratch: join(runRoot, 'scratch', String(++n)), prompt: plan.probe.prompt, model: opts.model, claude: opts.claude });
          if (t.unhooked > 0) throw new EvalError(`${t.error}; stopping before anything else runs`);
          const changed = changedSince(dirs[arm], before[arm]!);
          // Not the names: they were written behind the hooks, so they are the agent's text (D39).
          if (changed.length > 0) throw new EvalError(`a run changed ${changed.length} file${changed.length === 1 ? '' : 's'} in the copy behind the hooks; stopping before anything else runs`);
          plan.records[arm].push({
            passed: t.error === null && grade(plan.probe, t),
            error: t.error,
            model: t.model,
            inputTokens: t.inputTokens,
            turns: t.turns,
            durationMs: t.durationMs,
            costUsd: t.costUsd,
            loads: t.error === null ? joinLoads(t, scans[arm], dirs[arm]) : [],
          });
          result.totals.runs++;
          result.totals.costUsd += t.costUsd;
          result.model ??= t.model;
          if (t.utilization !== null) {
            result.totals.utilizationBefore ??= t.utilization;
            result.totals.utilizationAfter = t.utilization;
          }
        }
      }
      plan.complete = plan.records.base.length === opts.runs && plan.records.head.length === opts.runs;
      if (!plan.complete) continue;
      for (const arm of ['base', 'head'] as const) {
        const key = plan.keys[arm];
        const keep = plan.records[arm].filter((r) => r.error === null);
        if (key !== null && keep.length > plan.cached[arm]) {
          mkdirSync(opts.cacheDir!, { recursive: true });
          writeFileSync(join(opts.cacheDir!, `${key}.json`), JSON.stringify({ records: keep }));
        }
      }
    }

    for (const plan of plans) {
      const { probe, source, changedInHead } = plan;
      let outcome: ProbeOutcome;
      if (!plan.runnable) outcome = { probe, source, changedInHead, base: null, head: null, status: 'not-run', reason: `run budget (${opts.maxRuns} runs)` };
      else if (!plan.complete && !plan.started) outcome = { probe, source, changedInHead, base: null, head: null, status: 'not-run', reason: `time budget (${opts.maxMinutes} min)` };
      else {
        const arms = { base: summarise(probe, plan.records.base, plan.cached.base), head: summarise(probe, plan.records.head, plan.cached.head) };
        result.totals.cachedRuns += plan.cached.base + plan.cached.head;
        outcome = plan.complete
          ? { probe, source, changedInHead, ...arms, status: status(arms.base, arms.head) }
          : { probe, source, changedInHead, ...arms, status: 'inconclusive', reason: `time budget (${opts.maxMinutes} min)` };
      }
      result.outcomes.push(outcome);
    }
    result.gateFailures = result.outcomes.filter(gated).map((o) => o.probe.id);
  } finally {
    if (!opts.keepRuns) rmSync(runRoot, { recursive: true, force: true });
  }
  result.totals.wallMs = now() - started;
  return result;
}
