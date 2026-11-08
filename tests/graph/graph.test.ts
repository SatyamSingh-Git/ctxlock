import { describe, expect, it } from 'vitest';
import { GENERATED_FILE, serializeGenerated } from '../../src/build/generated.js';
import { buildGraph, impactOf, resolveRef, whoUses } from '../../src/graph/graph.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';

const scan = (files: Record<string, string>, symlinks: Record<string, string | null> = {}) => scanRepo(memReader(files, symlinks), { today: '2026-11-08' });
const graphOf = async (files: Record<string, string>, symlinks: Record<string, string | null> = {}) => {
  const s = await scan(files, symlinks);
  return buildGraph({ ...s, generated: s.generated.files });
};

const SKILL = '---\nname: release\ndescription: Releases the project\n---\nRun it.\n';
const A = 'rule/.claude/rules/a.md';
const B = 'rule/.claude/rules/b.md';
const C = 'rule/.claude/rules/c.md';

// c depends on b, b on a, and a consumer on c. b is named by its ID, the others by path.
const CHAIN = {
  '.claude/rules/a.md': 'Use pnpm.\n',
  '.claude/rules/b.md': 'Run pnpm test.\n',
  '.claude/rules/c.md': 'Run pnpm lint.\n',
  '.github/CODEOWNERS': '.claude/rules/a.md @rules-team\n',
  'ctxlock.yaml': `version: 1
units:
  .claude/rules/b.md:
    depends-on: [.claude/rules/a.md]
  .claude/rules/c.md:
    depends-on: [${B}]
consumers:
  payments-api:
    owner: "@payments-team"
    depends-on: [.claude/rules/c.md@certified]
`,
};

describe('resolveRef', () => {
  it('finds a unit by its path, its ID or a symlink alias, and nothing for a path that is no unit', async () => {
    const s = await scan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL }, { '.claude/skills/release': '.agents/skills/release' });
    const skill = s.units.find((u) => u.kind === 'skill')!;

    expect(resolveRef('.agents/skills/release', s.units)).toBe(skill);
    expect(resolveRef('skill/.agents/skills/release', s.units)).toBe(skill);
    expect(resolveRef('.claude/skills/release', s.units)).toBe(skill);
    expect(resolveRef('.agents/skills/nope', s.units)).toBeUndefined();
  });
});

describe('buildGraph', () => {
  it('records depends-on edges, consumers, predicted loads, generated copies, tiers and owners', async () => {
    const record = serializeGenerated([
      { path: '.claude/skills/release/SKILL.md', sha256: lfDigest(Buffer.from(SKILL)), from: [{ path: '.agents/skills/release/SKILL.md', sha256: lfDigest(Buffer.from(SKILL)) }] },
    ]);
    const g = await graphOf({ ...CHAIN, 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.claude/skills/release/SKILL.md': SKILL, [GENERATED_FILE]: record });

    expect(g.dependsOn.get(B)).toEqual([{ id: A }]);
    expect(g.dependsOn.get(C)).toEqual([{ id: B }]);
    expect(g.consumers.map((c) => [c.name, c.uses])).toEqual([['payments-api', [{ id: C, tier: 'certified' }]]]);
    expect(g.loads.get('skill/.agents/skills/release')).toEqual([{ harness: 'codex', site: '', mode: 'listed' }]);
    expect(g.loads.get(A)).toEqual([{ harness: 'claude-code', site: '', mode: 'always' }]);
    expect(g.compiledTo.get('skill/.agents/skills/release')).toEqual(['.claude/skills/release/SKILL.md']);
    expect(g.tier(A)).toBe('reviewed');
    expect(g.owners(A)).toEqual(['@rules-team']);
    expect(g.dangling).toEqual([]);
  });

  it('lists each reference that names no unit, with where it is written', async () => {
    const yaml = 'version: 1\nunits:\n  gone.md: {}\n  .claude/rules/a.md:\n    tier: certified\n    depends-on: [missing.md]\nconsumers:\n  web:\n    depends-on: [nope.md]\n';
    const g = await graphOf({ '.claude/rules/a.md': 'A.\n', 'ctxlock.yaml': yaml });

    expect(g.dangling).toEqual([
      { from: 'ctxlock.yaml', ref: 'gone.md' },
      { from: '.claude/rules/a.md', ref: 'missing.md' },
      { from: 'consumer web', ref: 'nope.md' },
    ]);
    expect(g.tier(A)).toBe('certified');
  });
});

describe('whoUses', () => {
  it('walks what depends on a unit, directly or not, and the consumers that use it', async () => {
    const w = whoUses(await graphOf(CHAIN), A);

    expect(w.units).toEqual([
      { id: B, via: [] },
      { id: C, via: [B] },
    ]);
    expect(w.consumers).toEqual([{ name: 'payments-api', owner: '@payments-team', maturity: 'production', via: [C, B] }]);
    expect(w.loads).toEqual([{ harness: 'claude-code', site: '', mode: 'always' }]);
    expect(w.generated).toEqual([]);
  });

  it('gives a consumer that uses several reached units its shortest chain', async () => {
    const yaml = `${CHAIN['ctxlock.yaml']}  web:\n    depends-on: [.claude/rules/c.md, .claude/rules/a.md]\n`;
    const w = whoUses(await graphOf({ ...CHAIN, 'ctxlock.yaml': yaml }), A);
    expect(w.consumers.map((c) => [c.name, c.via])).toEqual([
      ['payments-api', [C, B]],
      ['web', []],
    ]);
  });

  it('stops on a cycle, and on a unit that names itself, listing each unit once', async () => {
    const yaml = 'version: 1\nunits:\n  .claude/rules/a.md:\n    depends-on: [.claude/rules/b.md, .claude/rules/a.md]\n  .claude/rules/b.md:\n    depends-on: [.claude/rules/a.md]\n';
    const g = await graphOf({ '.claude/rules/a.md': 'A.\n', '.claude/rules/b.md': 'B.\n', 'ctxlock.yaml': yaml });

    expect(whoUses(g, A).units).toEqual([{ id: B, via: [] }]);
    expect(whoUses(g, B).units).toEqual([{ id: A, via: [] }]);
  });
});

describe('impactOf', () => {
  const impact = async (base: Record<string, string>, head: Record<string, string>) => impactOf(await scan(base), await scan(head));

  it("reaches what depends on a modified unit, and asks its owners and the consumers' owners", async () => {
    expect(await impact(CHAIN, { ...CHAIN, '.claude/rules/a.md': 'Use pnpm, always.\n' })).toEqual({
      changed: [{ id: A, change: 'modified' }],
      dependents: [
        { id: B, via: [], on: A },
        { id: C, via: [B], on: A },
      ],
      consumers: [{ name: 'payments-api', owner: '@payments-team', maturity: 'production', via: [C, B] }],
      owners: ['@payments-team', '@rules-team'],
    });
  });

  it('still reaches what depended on a unit when the same change deletes that depends-on, so a change cannot hide its reach', async () => {
    const unhooked = CHAIN['ctxlock.yaml'].replace('  .claude/rules/b.md:\n    depends-on: [.claude/rules/a.md]\n', '');
    const i = await impact(CHAIN, { ...CHAIN, '.claude/rules/a.md': 'Use npm.\n', 'ctxlock.yaml': unhooked });

    expect(i.dependents.map((d) => [d.id, d.on])).toEqual([
      [B, A],
      [C, A],
    ]);
    expect(i.consumers.map((c) => c.name)).toEqual(['payments-api']);
  });

  it('finds what depended on a removed unit in the base', async () => {
    const { '.claude/rules/a.md': _, ...head } = CHAIN;
    const i = await impact(CHAIN, head);

    expect(i.changed).toEqual([{ id: A, change: 'removed' }]);
    expect(i.dependents.map((d) => d.id)).toEqual([B, C]);
    expect(i.owners).toEqual(['@payments-team', '@rules-team']);
  });

  it('lists a dependent that changed too under changed only, with the shortest way to what it reaches', async () => {
    const i = await impact(CHAIN, { ...CHAIN, '.claude/rules/a.md': 'A2.\n', '.claude/rules/b.md': 'B2.\n' });

    expect(i.changed.map((c) => c.id)).toEqual([A, B]);
    expect(i.dependents).toEqual([{ id: C, via: [], on: B }]);
    expect(i.consumers.map((c) => c.via)).toEqual([[C]]);
  });

  it('with no ctxlock.yaml, lists the changes and nothing they reach', async () => {
    const { 'ctxlock.yaml': _, '.github/CODEOWNERS': __, ...plain } = CHAIN;
    expect(await impact(plain, { ...plain, '.claude/rules/a.md': 'A2.\n' })).toEqual({ changed: [{ id: A, change: 'modified' }], dependents: [], consumers: [], owners: [] });
  });
});
