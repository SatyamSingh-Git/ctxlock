import type { Finding, HarnessId } from '../../model.js';
import type { Rule } from '../types.js';
import { shadowed } from './l13-shadowed.js';

export const coverage: Rule = {
  id: 'L11-coverage',
  check({ units, contexts, registry }) {
    // With one harness configured, every unit it reaches reaches all of them, so nothing is reported.
    const configured = new Set(registry.harnesses);
    const reached = new Map<string, Set<HarnessId>>();
    for (const { harness, entries } of contexts) {
      for (const { unitId } of entries) {
        if (!reached.has(unitId)) reached.set(unitId, new Set());
        reached.get(unitId)!.add(harness);
      }
    }
    // L13 reports these with a fix, so they are not repeated here.
    const leftToL13 = new Set(shadowed(contexts).map((s) => s.unitId));

    const findings: Finding[] = [];
    for (const unit of units) {
      const harnesses = reached.get(unit.id);
      if (leftToL13.has(unit.id) || !harnesses || harnesses.size === configured.size) continue;
      const path = unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path;
      const only = registry.harnesses.filter((h) => harnesses.has(h));
      findings.push({ rule: 'L11-coverage', severity: 'info', message: `${path} reaches ${[...new Set(only)].join(', ')} only`, path, unitId: unit.id });
    }
    return findings;
  },
};
