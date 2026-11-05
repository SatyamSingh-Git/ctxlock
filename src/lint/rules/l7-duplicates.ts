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

// The folder a skill belongs to: X for X/.claude/skills/s and X/.agents/skills/s. Same-named skills
// in different packages are different skills, not copies.
const owner = (unit: Unit) => posix.dirname(posix.dirname(posix.dirname(unit.path)));

export const duplicateSkills: Rule = {
  id: 'L7-duplicate-skill',
  check({ units, contexts }) {
    const findings: Finding[] = [];
    const skills = units
      .filter((u) => u.kind === 'skill')
      .map((unit) => ({ unit, contents: contents(unit), words: words(description(unit)), owner: owner(unit) }));
    // Two skills compete only where one agent lists both at once.
    const listings = contexts.map((c) => new Set(c.entries.filter((e) => e.mode === 'listed').map((e) => e.unitId)));
    const listedTogether = (a: Unit, b: Unit) => listings.some((ids) => ids.has(a.id) && ids.has(b.id));

    for (const [i, a] of skills.entries()) {
      for (const b of skills.slice(i + 1)) {
        const report = (message: string) =>
          findings.push({ rule: 'L7-duplicate-skill', severity: 'should', message, path: `${b.unit.path}/SKILL.md`, unitId: b.unit.id });
        if (a.contents === b.contents) continue;
        if (a.unit.name === b.unit.name) {
          if (a.owner === b.owner) report(`diverged copies: skill ${a.unit.name} at ${a.unit.path} and ${b.unit.path} have different contents`);
          continue;
        }
        if (!listedTogether(a.unit, b.unit)) continue;
        const shared = [...a.words].filter((w) => b.words.has(w)).length;
        const union = a.words.size + b.words.size - shared;
        if (shared / union >= 0.5) {
          report(
            `description is a near-duplicate of skill ${a.unit.name} (${a.unit.path}/SKILL.md): ${Math.round((100 * shared) / union)}% of their words are shared, so an agent may pick the wrong one`,
          );
        }
      }
    }
    return findings;
  },
};
