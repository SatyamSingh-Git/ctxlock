import { GENERATED_FILE, type GeneratedState } from '../build/generated.js';
import type { Drift } from '../build/drift.js';
import type { Gap } from '../build/plan.js';
import type { BudgetRow } from './budget.js';
import { budgetTable, table } from './render.js';

export interface BuildReport {
  root: string;
  budget: BudgetRow[];
  // The budget once the planned fills are written; null when nothing is planned.
  after: BudgetRow[] | null;
  gaps: Gap[];
  drift: Drift[];
  generated: Array<{ path: string; state: GeneratedState; source?: string }>;
  written: string[];
  refused: string[];
  filled: boolean;
}

const STATES: Record<GeneratedState, (source?: string) => string> = {
  ok: () => 'up to date',
  missing: () => 'missing',
  edited: () => 'edited by hand',
  'source-missing': (source) => `${source} is gone`,
  stale: (source) => `stale: ${source} changed`,
};

const list = (title: string, lines: string[]) => (lines.length ? ['', title, ...lines.map((l) => `  ${l}`)] : []);

export function renderBuild(r: BuildReport, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(r, null, 2)}\n`;
  // After a fill, the gaps it closed are the files under Wrote.
  const gaps = r.filled ? r.gaps.filter((g) => g.fill === null) : r.gaps;
  const fills = r.gaps.filter((g) => g.fill !== null).length;
  const gapRows = gaps.map((g) => [`  ${g.path} does not reach ${g.harness}`, g.fill ? `fill: ${g.fill} (${g.reason})` : `no fill: ${g.reason}`]);
  const lines = [
    `ctxlock build · ${r.root}`,
    '',
    'Budget:',
    budgetTable(r.budget),
    ...(r.after && !r.filled ? ['', 'Budget after --fill-missing:', budgetTable(r.after)] : []),
    ...(gapRows.length ? ['', 'Gaps:', table(gapRows)] : ['', 'No gaps between the configured agents.']),
    ...list('Drift:', r.drift.map((d) => `${d.paths[0]} and ${d.paths[1]}: ${d.summary}`)),
    ...(r.generated.length ? ['', `Generated (${GENERATED_FILE}):`, table(r.generated.map((g) => [`  ${g.path}`, STATES[g.state](g.source)]))] : []),
    ...list('Wrote:', r.written),
    ...list('Not written, since a person wrote or edited it after the plan:', r.refused),
    ...(!r.filled && fills > 0 ? ['', `ctxlock build --fill-missing writes the ${fills} fill${fills === 1 ? '' : 's'} above.`] : []),
  ];
  return `${lines.join('\n')}\n`;
}
