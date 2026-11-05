import type { Finding } from '../../model.js';
import type { Rule } from '../types.js';

const MANDATORY = /\b(always|must|never skip)\b[^.\n]{0,40}\b(run|verify|check|test|validate|confirm|re-?run)\b/gi;
const CHECKBOX = /^\s*- \[ \]/gm;

export const procedure: Rule = {
  id: 'L8-procedure',
  check({ units }) {
    const findings: Finding[] = [];
    for (const unit of units) {
      if (unit.kind !== 'skill' && unit.kind !== 'rule') continue;
      const count = (unit.body.match(MANDATORY)?.length ?? 0) + (unit.body.match(CHECKBOX)?.length ?? 0);
      if (count < 5) continue;
      findings.push({
        rule: 'L8-procedure',
        severity: 'info',
        message: `${unit.kind} ${unit.name}: ${count} mandatory checks and checklist items; excessive procedure is the most common way skills fail`,
        path: unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path,
        unitId: unit.id,
      });
    }
    return findings;
  },
};
