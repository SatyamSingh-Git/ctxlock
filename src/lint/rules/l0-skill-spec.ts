import { posix } from 'node:path';
import type { Finding } from '../../model.js';
import { splitFrontmatter } from '../../units/frontmatter.js';
import type { Rule } from '../types.js';

// Ported from the Agent Skills reference validator, skills-ref/src/skills_ref/validator.py in
// agentskills/agentskills at 83021e2b (Apache-2.0). Like it, names may use any lowercase Unicode
// letter after NFKC normalisation. Its unknown-field check is not ported: Claude Code and other
// clients define fields of their own (when_to_use, disable-model-invocation, ...).
export const skillSpec: Rule = {
  id: 'L0-skill-spec',
  check({ units, limits }) {
    const findings: Finding[] = [];
    for (const unit of units) {
      if (unit.kind !== 'skill') continue;
      const report = (message: string) =>
        findings.push({ rule: 'L0-skill-spec', severity: 'must', message, path: `${unit.path}/SKILL.md`, unitId: unit.id });

      if (unit.frontmatter === null) {
        // Unparseable frontmatter is already an L0-frontmatter finding from discovery.
        if (splitFrontmatter(unit.text).error === null) report('SKILL.md has no frontmatter, so it has no name or description');
        continue;
      }
      const { name, description, compatibility } = unit.frontmatter;

      if (typeof name !== 'string' || !name.trim()) {
        report('name must be a non-empty string');
      } else {
        const n = name.trim().normalize('NFKC');
        const length = [...n].length;
        if (length > limits.skillNameMax) report(`name "${n}" is ${length} characters; the limit is ${limits.skillNameMax}`);
        if (n !== n.toLowerCase()) report(`name "${n}" must be lowercase`);
        if (n.startsWith('-') || n.endsWith('-')) report(`name "${n}" must not start or end with a hyphen`);
        if (n.includes('--')) report(`name "${n}" must not contain consecutive hyphens`);
        if (!/^[\p{L}\p{N}-]+$/u.test(n)) report(`name "${n}" may contain only letters, digits and hyphens`);
        const dir = posix.basename(unit.path);
        if (dir.normalize('NFKC') !== n) report(`name "${n}" must match its directory name "${dir}"`);
      }

      if (typeof description !== 'string' || !description.trim()) {
        report('description must be a non-empty string');
      } else if ([...description].length > limits.skillDescriptionMax) {
        report(`description is ${[...description].length} characters; the limit is ${limits.skillDescriptionMax}`);
      }

      if (compatibility !== undefined) {
        if (typeof compatibility !== 'string') report('compatibility must be a string');
        else if ([...compatibility].length > limits.skillCompatibilityMax) {
          report(`compatibility is ${[...compatibility].length} characters; the limit is ${limits.skillCompatibilityMax}`);
        }
      }
    }
    return findings;
  },
};
