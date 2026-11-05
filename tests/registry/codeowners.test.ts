import { describe, expect, it } from 'vitest';
import { loadCodeowners, unitOwners } from '../../src/registry/codeowners.js';
import { loadRegistry } from '../../src/registry/registry.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

describe('loadCodeowners', () => {
  it('the last matching pattern wins, a docs/ pattern covers docs/a/b.md, and an owner-less line unassigns', async () => {
    const owners = await loadCodeowners(
      memReader({
        '.github/CODEOWNERS': [
          '# comment',
          '*            @everyone',
          'docs/        @docs-team',
          '/AGENTS.md   @platform @lead   # inline comment',
          'docs/drafts/',
        ].join('\n'),
      }),
    );

    expect(owners.present).toBe(true);
    expect(owners.ownersOf('src/x.ts')).toEqual(['@everyone']);
    expect(owners.ownersOf('docs/a/b.md')).toEqual(['@docs-team']);
    expect(owners.ownersOf('AGENTS.md')).toEqual(['@platform', '@lead']);
    expect(owners.ownersOf('pkg/AGENTS.md')).toEqual(['@everyone']);
    expect(owners.ownersOf('docs/drafts/x.md')).toEqual([]);
  });

  it('CODEOWNERS is read from .github/ before root before docs/', async () => {
    const all = { '.github/CODEOWNERS': '* @github', CODEOWNERS: '* @root', 'docs/CODEOWNERS': '* @docs' };

    expect((await loadCodeowners(memReader(all))).ownersOf('x')).toEqual(['@github']);
    expect((await loadCodeowners(memReader({ CODEOWNERS: '* @root', 'docs/CODEOWNERS': '* @docs' }))).ownersOf('x')).toEqual(['@root']);
    expect((await loadCodeowners(memReader({ 'docs/CODEOWNERS': '* @docs' }))).ownersOf('x')).toEqual(['@docs']);
  });

  it('absent CODEOWNERS gives present false and no owners', async () => {
    const owners = await loadCodeowners(memReader({ 'AGENTS.md': 'a' }));

    expect(owners.present).toBe(false);
    expect(owners.ownersOf('AGENTS.md')).toEqual([]);
  });
});

describe('unitOwners', () => {
  const skill = '---\nname: x\ndescription: d\n---\n';

  it('a registry owner overrides CODEOWNERS for that unit, and a skill matches its entry by directory path', async () => {
    const reader = memReader({
      'AGENTS.md': 'a',
      'CLAUDE.md': 'c',
      '.agents/skills/x/SKILL.md': skill,
      CODEOWNERS: '* @fallback',
      'ctxlock.yaml': 'version: 1\nunits:\n  AGENTS.md:\n    owner: "@registry"\n  .agents/skills/x:\n    owner: "@skill-owner"\n',
    });
    const { units } = await discoverUnits(reader);
    const registry = await loadRegistry(reader);
    const codeowners = await loadCodeowners(reader);
    const ownerOf = (id: string) => unitOwners(units.find((u) => u.id === id)!, registry, codeowners);

    expect(ownerOf('instructions/AGENTS.md')).toEqual(['@registry']);
    expect(ownerOf('skill/.agents/skills/x')).toEqual(['@skill-owner']);
    expect(ownerOf('instructions/CLAUDE.md')).toEqual(['@fallback']);
  });

  it('a CODEOWNERS directory pattern owns a skill', async () => {
    const reader = memReader({ '.agents/skills/x/SKILL.md': skill, CODEOWNERS: '.agents/skills/x/ @skill-team' });
    const { units } = await discoverUnits(reader);

    expect(unitOwners(units[0]!, await loadRegistry(reader), await loadCodeowners(reader))).toEqual(['@skill-team']);
  });
});
