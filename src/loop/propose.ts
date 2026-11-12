import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from '../eval/claude.js';
import { type ProbeOutcome, type ProbeRun, runProbes } from '../eval/eval.js';
import { loadProbes } from '../eval/probes.js';
import { ancestorContext } from '../eval/workspace.js';
import { buildGraph } from '../graph/graph.js';
import type { Tier } from '../registry/registry.js';
import { overlayReader } from '../repo/overlay.js';
import { fsReader } from '../repo/reader.js';
import { scanRepo } from '../scan.js';
import { applyFix, type Diagnosis, DiagnosisError, diagnosisPrompt, parseDiagnosis } from './diagnose.js';
import type { UnitMiss } from './misses.js';

export type Replay = { status: 'validated' | 'not-validated' | 'inconclusive'; runsPerArm: number; miss: ProbeOutcome; others: ProbeOutcome[] };

export interface Proposal {
  unit: UnitMiss;
  diagnosis: Diagnosis;
  // null when there is no fix to replay.
  replay: Replay | null;
  // Claude Code runs, the diagnosis's included.
  runs: number;
  tier: Tier;
}

export interface DiagnoseOptions {
  root: string;
  miss: UnitMiss;
  model: string;
  claude: string[];
  workdir: string;
  runs: number;
  maxRuns: number;
  maxMinutes: number;
}

// D86: validated when the miss's probe goes from failing to passing with the fix, and nothing on the
// unit gets worse. A run the budgets cut short says nothing either way.
function judge(miss: ProbeOutcome, others: ProbeOutcome[]): Replay['status'] {
  if ([miss, ...others].some((o) => o.status === 'not-run' || o.status === 'inconclusive')) return 'inconclusive';
  return miss.status === 'improved' && !others.some((o) => o.status === 'regressed') ? 'validated' : 'not-validated';
}

// The diagnosis, and for a fix, its replay. Both run in throwaway folders: nothing is written to the
// repository (D86).
export async function diagnose(opts: DiagnoseOptions): Promise<Proposal> {
  // Without the gitignored CLAUDE.local.md, as eval and probe draft run.
  const reader = fsReader(opts.root, { local: false });
  const scan = await scanRepo(reader);
  const unit = scan.units.find((u) => u.id === opts.miss.id);
  if (!unit) throw new DiagnosisError(`no unit ${opts.miss.id} in ${opts.root}`);
  const tier = buildGraph({ ...scan, generated: scan.generated.files }).tier(unit.id);

  mkdirSync(opts.workdir, { recursive: true });
  const runRoot = mkdtempSync(join(opts.workdir, 'ctxlock-diagnose-'));
  try {
    const ask = join(runRoot, 'ask');
    const [found] = ancestorContext(ask);
    if (found) throw new DiagnosisError(`${found} is above the run folder and would load into the diagnosis; pass --workdir <a folder outside it>`);
    mkdirSync(ask);
    const asked = await runClaude({ dir: ask, scratch: join(runRoot, 'scratch'), prompt: diagnosisPrompt(unit, opts.miss), model: opts.model, claude: opts.claude, tools: [] });
    if (asked.error) throw new DiagnosisError(`the diagnosis run failed: ${asked.error}`);
    const diagnosis = parseDiagnosis(asked.text, unit, opts.miss);
    if (!diagnosis.fix || !diagnosis.probe) return { unit: opts.miss, diagnosis, replay: null, runs: 1, tier };

    const fixed = applyFix(unit, diagnosis.fix);
    // A copy turns each link into the bytes of its target, so a unit reached through a link is fixed
    // in its target.
    const links = [...(await reader.listSymlinks())];
    const real = links.reduce((path, [link, target]) => (target !== null && (path === link || path.startsWith(`${link}/`)) ? `${target}${path.slice(link.length)}` : path), fixed.path);
    const head = overlayReader(reader, new Map([[real, fixed.bytes]]));
    // The unit's own probes are its golden set: the fix may not make one of them worse.
    const own = (await loadProbes(reader)).filter((p) => p.unit === unit.id);
    const probes: ProbeRun[] = [
      { probe: diagnosis.probe, source: 'head', changedInHead: false, selectedFor: 'the miss' },
      ...own.map((probe) => ({ probe, source: 'base' as const, changedInHead: false, selectedFor: 'changed' })),
    ];
    const ran = await runProbes({ base: reader, head }, { base: scan, head: await scanRepo(head) }, probes, {
      runs: opts.runs,
      maxRuns: opts.maxRuns,
      maxMinutes: opts.maxMinutes,
      model: opts.model,
      claude: opts.claude,
      workdir: join(runRoot, 'replay'),
      cacheDir: null,
      ctxlockVersion: '',
      keepRuns: false,
      trees: { base: null, head: null },
    });
    const [miss, ...others] = ran.outcomes;
    return { unit: opts.miss, diagnosis, replay: { status: judge(miss!, others), runsPerArm: opts.runs, miss: miss!, others }, runs: 1 + ran.totals.runs, tier };
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}
