import { describe, expect, it } from 'vitest';
import { skillSpec } from '../../src/lint/rules/l0-skill-spec.js';
import { lintContext } from '../helpers/lint.js';

const skillAt = (dir: string, fields: Record<string, string>) => ({
  [`.agents/skills/${dir}/SKILL.md`]: `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\nBody.\n`,
});

async function messages(files: Record<string, string>) {
  return (await skillSpec.check(await lintContext(files))).map((f) => f.message);
}

describe('L0-skill-spec', () => {
  it('a valid skill passes', async () => {
    expect(await messages(skillAt('release-notes', { name: 'release-notes', description: 'Writes release notes' }))).toEqual([]);
    expect(await messages(skillAt('a'.repeat(64), { name: 'a'.repeat(64), description: 'd' }))).toEqual([]);
  });

  it('compares the name and directory after NFKC normalisation, like the reference validator', async () => {
    const decomposed = `cafe${String.fromCodePoint(0x301)}`;

    expect(await messages(skillAt('café', { name: decomposed, description: 'd' }))).toEqual([]);
  });

  it('Bad-Name, a--b and a 65-char name fail', async () => {
    const long = 'a'.repeat(65);
    const findings = await skillSpec.check(
      await lintContext({
        ...skillAt('Bad-Name', { name: 'Bad-Name', description: 'd' }),
        ...skillAt('a--b', { name: 'a--b', description: 'd' }),
        ...skillAt(long, { name: long, description: 'd' }),
      }),
    );

    expect(findings.map((f) => [f.rule, f.severity, f.path, f.message])).toEqual([
      ['L0-skill-spec', 'must', '.agents/skills/Bad-Name/SKILL.md', 'name "Bad-Name" must be lowercase'],
      ['L0-skill-spec', 'must', '.agents/skills/a--b/SKILL.md', 'name "a--b" must not contain consecutive hyphens'],
      ['L0-skill-spec', 'must', `.agents/skills/${long}/SKILL.md`, `name "${long}" is 65 characters; the limit is 64`],
    ]);
  });

  it('a leading hyphen or an underscore fails', async () => {
    expect(
      await messages({
        ...skillAt('-x', { name: '-x', description: 'd' }),
        ...skillAt('my_skill', { name: 'my_skill', description: 'd' }),
      }),
    ).toEqual(['name "-x" must not start or end with a hyphen', 'name "my_skill" may contain only letters, digits and hyphens']);
  });

  it('a lowercase Chinese or Cyrillic name passes, as the reference validator allows', async () => {
    expect(
      await messages({
        ...skillAt('技能', { name: '技能', description: 'd' }),
        ...skillAt('мой-навык', { name: 'мой-навык', description: 'd' }),
      }),
    ).toEqual([]);
  });

  it('a name differing from the directory fails', async () => {
    expect(await messages(skillAt('notes', { name: 'release-notes', description: 'd' }))).toEqual([
      'name "release-notes" must match its directory name "notes"',
    ]);
  });

  it('a description of 1024 chars passes and 1025 fails', async () => {
    expect(await messages(skillAt('ok', { name: 'ok', description: 'd'.repeat(1024) }))).toEqual([]);
    expect(await messages(skillAt('long', { name: 'long', description: 'd'.repeat(1025) }))).toEqual([
      'description is 1025 characters; the limit is 1024',
    ]);
  });

  it('a 501-char compatibility fails', async () => {
    expect(await messages(skillAt('ok', { name: 'ok', description: 'd', compatibility: 'c'.repeat(500) }))).toEqual([]);
    expect(await messages(skillAt('long', { name: 'long', description: 'd', compatibility: 'c'.repeat(501) }))).toEqual([
      'compatibility is 501 characters; the limit is 500',
    ]);
  });

  it('missing frontmatter, name or description fails; broken frontmatter is left to discovery', async () => {
    expect(
      await messages({
        '.agents/skills/bare/SKILL.md': 'Just text.\n',
        '.agents/skills/empty/SKILL.md': '---\nlicense: MIT\n---\nBody.\n',
        '.agents/skills/broken/SKILL.md': '---\nname: [unclosed\n---\nBody.\n',
        '.agents/skills/num/SKILL.md': '---\nname: num\ndescription: d\ncompatibility: 5\n---\n',
        ...skillAt('space', { name: 'space', description: '   ' }),
      }),
    ).toEqual([
      'SKILL.md has no frontmatter, so it has no name or description',
      'name must be a non-empty string',
      'description must be a non-empty string',
      'compatibility must be a string',
      'description must be a non-empty string',
    ]);
  });
});
