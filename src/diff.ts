import { type Impact, impactOf, unitChanges } from './graph/graph.js';
import type { Finding } from './model.js';
import type { BudgetRow } from './report/budget.js';
import type { ScanResult } from './scan.js';

export interface UnitChange {
  id: string;
  change: 'added' | 'removed' | 'modified';
}

export interface DiffResult {
  base: ScanResult;
  head: ScanResult;
  changes: UnitChange[];
  impact: Impact;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  // Only rows whose alwaysBytes changed.
  budget: Array<BudgetRow & { baseAlwaysBytes: number }>;
  execChanges: Finding[];
  existingMust: number;
}

// Positions and counts in messages move with unrelated edits ("at 14:7", "is 33902 bytes",
// "(1 unit)" becoming "(4 units)"), so findings are matched without them. A finding about hidden
// content carries a fingerprint of all of it, since its message quotes only the start.
const key = (f: Finding) =>
  `${f.rule}|${f.unitId ?? f.path ?? ''}|${f.data?.fingerprint ?? f.message.replace(/\b\d+\b/g, '#').replace(/# (\w+?)s\b/g, '# $1')}`;

// Findings in `from` with no counterpart in `against`, matched one to one, so a second copy of a
// finding a file already had still counts as new.
function unmatched(from: Finding[], against: Finding[]): Finding[] {
  const left = new Map<string, number>();
  for (const f of against) left.set(key(f), (left.get(key(f)) ?? 0) + 1);
  return from.filter((f) => {
    const n = left.get(key(f)) ?? 0;
    if (n === 0) return true;
    left.set(key(f), n - 1);
    return false;
  });
}

const isInventory = (f: Finding) => f.rule === 'L2-exec-config';
const isMust = (f: Finding) => f.severity === 'must';

export function diffScans(base: ScanResult, head: ScanResult): DiffResult {
  const changes = unitChanges(base, head);

  // Inventory items are reported once, as execution-affecting changes, not again as new findings.
  const headFindings = head.findings.filter((f) => !isInventory(f));
  const baseFindings = base.findings.filter((f) => !isInventory(f));
  const newFindings = unmatched(headFindings, baseFindings);

  const known = new Set(base.inventory.map((f) => f.data?.fingerprint));
  const severity = head.registry.lint.severity['L2-exec-config-changed'] ?? 'must';
  const execChanges =
    severity === 'off'
      ? []
      : head.inventory
          .filter((f) => !known.has(f.data?.fingerprint))
          .map((f) => ({ ...f, rule: 'L2-exec-config-changed', severity, message: `New or changed: ${f.message}` }));

  const before = new Map(base.budget.map((r) => [`${r.harness}\0${r.site}`, r]));
  const budget = head.budget.flatMap((row) => {
    const baseAlwaysBytes = before.get(`${row.harness}\0${row.site}`)?.alwaysBytes ?? 0;
    return baseAlwaysBytes === row.alwaysBytes ? [] : [{ ...row, baseAlwaysBytes }];
  });
  const headSites = new Set(head.budget.map((r) => `${r.harness}\0${r.site}`));
  for (const row of base.budget) {
    if (!headSites.has(`${row.harness}\0${row.site}`) && row.alwaysBytes > 0) budget.push({ ...row, alwaysBytes: 0, truncated: [], baseAlwaysBytes: row.alwaysBytes });
  }

  return {
    base,
    head,
    changes,
    impact: impactOf(base, head),
    newFindings,
    resolvedFindings: unmatched(baseFindings, headFindings),
    budget,
    execChanges,
    existingMust: headFindings.filter(isMust).length - newFindings.filter(isMust).length,
  };
}
