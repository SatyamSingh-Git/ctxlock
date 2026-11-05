import type { Finding } from '../../model.js';
import type { Rule } from '../types.js';

export const skillLength: Rule = {
  id: 'L6-skill-length',
  check({ units, limits }) {
    const findings: Finding[] = [];
    for (const unit of units) {
      if (unit.kind !== 'skill') continue;
      const { body } = unit;
      const lines = body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
      const chars = [...body].length;
      const report = (detail: string) =>
        findings.push({ rule: 'L6-skill-length', severity: 'should', message: `skill ${unit.name}: SKILL.md body is ${detail}`, path: `${unit.path}/SKILL.md`, unitId: unit.id });
      if (lines > limits.skillBodyLines) report(`${lines} lines (limit ${limits.skillBodyLines})`);
      if (chars > limits.skillBodyChars) report(`${chars} characters (limit ${limits.skillBodyChars}, about 5,000 tokens)`);
    }
    return findings;
  },
};
