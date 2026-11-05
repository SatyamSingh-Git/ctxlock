import { posix } from 'node:path';
import type { Finding, Unit } from '../../model.js';
import type { Rule } from '../types.js';

const STOPWORDS = new Set(
  'the and for with that this from into when use used using are was its any all can will your you not but has have how what which then than them they also such via each about'.split(' '),
);

const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOPWORDS.has(w)));

const description = (unit: Unit) => (typeof unit.frontmatter?.description === 'string' ? unit.frontmatter.description : '');

// A unit's digest covers its paths too, so two identical copies in different folders have different
// digests. Compare file contents relative to each skill's folder instead.
function contents(unit: Unit): string {
  const main = unit.files.filter((f) => f.path.endsWith('/SKILL.md')).reduce((a, b) => (b.path.length < a.path.length ? b : a));
  const dir = posix.dirname(main.path);
  return unit.files
    .map((f) => `${f.path.slice(dir.length)}\0${f.sha256}`)
    .sort()
    .join('\n');
}

export const duplicateSkills: Rule = {
  id: 'L7-duplicate-skill',
  check({ units }) {
    const findings: Finding[] = [];
    const skills = units.filter((u) => u.kind === 'skill');
    for (const [i, a] of skills.entries()) {
      for (const b of skills.slice(i + 1)) {
        const report = (message: string) => findings.push({ rule: 'L7-duplicate-skill', severity: 'should', message, path: `${b.path}/SKILL.md`, unitId: b.id });
        if (contents(a) === contents(b)) continue;
        if (a.name === b.name) {
          report(`diverged copies: skill ${a.name} at ${a.path} and ${b.path} have different contents`);
          continue;
        }
        const [wa, wb] = [words(description(a)), words(description(b))];
        const shared = [...wa].filter((w) => wb.has(w)).length;
        const union = wa.size + wb.size - shared;
        if (shared / union >= 0.5) {
          report(
            `description is a near-duplicate of skill ${a.name} (${a.path}/SKILL.md): ${Math.round((100 * shared) / union)}% of their words are shared, so an agent may pick the wrong one`,
          );
        }
      }
    }
    return findings;
  },
};
