import type { Finding, HarnessId } from '../../model.js';
import type { Rule } from '../types.js';
import { shadowed } from './l13-shadowed.js';

export const coverage: Rule = {
  id: 'L11-coverage',
  check({ units, contexts, registry, generated }) {
    // With one harness configured, every unit it reaches reaches all of them, so nothing is reported.
    const configured = new Set(registry.harnesses);
    const reached = new Map<string, Set<HarnessId>>();
    for (const { harness, entries } of contexts) {
      for (const { unitId } of entries) {
        if (!reached.has(unitId)) reached.set(unitId, new Set());
        reached.get(unitId)!.add(harness);
      }
    }
    // A file ctxlock build generated and its sources are one unit: between them, they reach both.
    const unitOf = new Map(units.flatMap((u) => u.files.map((f) => [f.path, u.id] as const)));
    const links: Array<[string, string]> = [];
    for (const g of generated) {
      for (const s of g.from) {
        const [a, b] = [unitOf.get(g.path), unitOf.get(s.path)];
        if (a && b && a !== b) links.push([a, b], [b, a]);
      }
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const [from, to] of links) {
        for (const h of reached.get(from) ?? []) {
          if (!reached.has(to)) reached.set(to, new Set());
          if (!reached.get(to)!.has(h)) {
            reached.get(to)!.add(h);
            changed = true;
          }
        }
      }
    }
    // L13 reports these with a fix, so they are not repeated here.
    const leftToL13 = new Set(shadowed(contexts, generated).map((s) => s.unitId));

    const findings: Finding[] = [];
    for (const unit of units) {
      const harnesses = reached.get(unit.id);
      if (leftToL13.has(unit.id) || !harnesses || harnesses.size === configured.size) continue;
      // A CLAUDE.md that is only `@AGENTS.md` has no content of its own for the other agents to miss.
      if (unit.text.trim().split(/\s+/).every((word) => word.startsWith('@'))) continue;
      const path = unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path;
      const only = registry.harnesses.filter((h) => harnesses.has(h));
      findings.push({ rule: 'L11-coverage', severity: 'info', message: `${path} reaches ${[...new Set(only)].join(', ')} only`, path, unitId: unit.id });
    }
    return findings;
  },
};
