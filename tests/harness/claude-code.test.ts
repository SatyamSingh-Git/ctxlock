import { describe, expect, it } from 'vitest';
import { resolveClaudeCode } from '../../src/harness/claude-code.js';
import { LIMITS } from '../../src/harness/limits.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

async function resolve(files: Record<string, string>, site = '', symlinks: Record<string, string | null> = {}) {
  const reader = memReader(files, symlinks);
  const { units } = await discoverUnits(reader);
  return resolveClaudeCode({ reader, units, limits: { ...LIMITS } }, site);
}

const always = (ctx: Awaited<ReturnType<typeof resolve>>) =>
  ctx.entries.filter((e) => e.mode === 'always').map((e) => [e.path, e.reason]);

const skill = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\nbody\n`;

describe('resolveClaudeCode', () => {
  it('ancestor CLAUDE.md files load always, shallowest first', async () => {
    const ctx = await resolve(
      {
        'CLAUDE.md': 'root',
        'a/CLAUDE.md': 'a',
        'a/b/.claude/CLAUDE.md': 'b dir',
        'a/b/CLAUDE.local.md': 'b local',
        'x/CLAUDE.md': 'sibling',
      },
      'a/b',
    );

    expect(always(ctx)).toEqual([
      ['CLAUDE.md', 'ancestor'],
      ['a/CLAUDE.md', 'ancestor'],
      ['a/b/.claude/CLAUDE.md', 'ancestor'],
      ['a/b/CLAUDE.local.md', 'ancestor'],
    ]);
  });

  it('AGENTS.md loads when no CLAUDE.md exists, and gets the not-loaded note when one does', async () => {
    const alone = await resolve({ 'AGENTS.md': 'agents' });
    expect(always(alone)).toEqual([['AGENTS.md', 'agents-md-fallback']]);
    expect(alone.notes).toEqual([]);

    const shadowed = await resolve({ 'AGENTS.md': 'agents', 'CLAUDE.md': 'claude' });
    expect(always(shadowed)).toEqual([['CLAUDE.md', 'ancestor']]);
    expect(shadowed.notes).toContain('AGENTS.md at AGENTS.md not loaded by Claude Code: CLAUDE.md exists');
  });

  it('@AGENTS.md in CLAUDE.md loads AGENTS.md with reason import:CLAUDE.md', async () => {
    const ctx = await resolve({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'a' });

    expect(always(ctx)).toEqual([
      ['CLAUDE.md', 'ancestor'],
      ['AGENTS.md', 'import:CLAUDE.md'],
    ]);
    expect(ctx.notes).toEqual([]);
    expect(ctx.alwaysBytes).toBe(12);
  });

  it('a CLAUDE.md symlinked to AGENTS.md loads the AGENTS.md unit with no not-loaded note', async () => {
    const ctx = await resolve({ 'AGENTS.md': 'shared' }, '', { 'CLAUDE.md': 'AGENTS.md' });

    expect(ctx.entries.map((e) => [e.path, e.unitId, e.reason])).toEqual([['CLAUDE.md', 'instructions/AGENTS.md', 'ancestor']]);
    expect(ctx.notes).toEqual([]);
  });

  it('imports stop after 4 hops', async () => {
    const ctx = await resolve({
      'CLAUDE.md': '@a.md',
      'a.md': '@b.md',
      'b.md': '@c.md',
      'c.md': '@d.md',
      'd.md': '@e.md',
      'e.md': 'too deep',
    });

    expect(always(ctx).map(([path]) => path)).toEqual(['CLAUDE.md', 'a.md', 'b.md', 'c.md', 'd.md']);
    expect(ctx.entries.find((e) => e.path === 'a.md')?.unitId).toBe('file/a.md');
  });

  it('a ~/ import is noted as not resolvable in the repo', async () => {
    const ctx = await resolve({ 'CLAUDE.md': 'See @~/.claude/personal.md\n' });

    expect(always(ctx)).toEqual([['CLAUDE.md', 'ancestor']]);
    expect(ctx.notes).toEqual(['external import ~/.claude/personal.md not resolvable in repo']);
  });

  it('an import cycle terminates and loads each file once', async () => {
    const ctx = await resolve({ 'CLAUDE.md': '@a.md', 'a.md': '@CLAUDE.md' });

    expect(always(ctx).map(([path]) => path)).toEqual(['CLAUDE.md', 'a.md']);
  });

  it('@types/node, user@example.com, and @x.md inside fences or inline code are not imports', async () => {
    const ctx = await resolve({
      'CLAUDE.md': 'Install @types/node.\nMail user@example.com\n```\n@x.md\n```\nUse `pnpm add @x.md` here.\n',
      'x.md': 'x',
    });

    expect(always(ctx)).toEqual([['CLAUDE.md', 'ancestor']]);
  });

  it('a nested CLAUDE.md of 50,000 chars is lazy with loadedBytes 40,000', async () => {
    const files = { 'CLAUDE.md': 'root', 'pkg/CLAUDE.md': 'x'.repeat(50_000) };

    const fromRoot = await resolve(files);
    expect(fromRoot.entries.find((e) => e.path === 'pkg/CLAUDE.md')).toMatchObject({
      mode: 'lazy',
      reason: 'nested',
      bytes: 50_000,
      loadedBytes: 40_000,
    });

    const fromPkg = await resolve(files, 'pkg');
    expect(fromPkg.entries.find((e) => e.path === 'pkg/CLAUDE.md')).toMatchObject({ mode: 'always', loadedBytes: 50_000 });
  });

  it('rules without paths are always; rules with paths are lazy', async () => {
    const ctx = await resolve({
      '.claude/rules/style.md': 'Use tabs.',
      '.claude/rules/tests.md': '---\npaths: ["**/*.test.ts"]\n---\nUse vitest.\n',
    });

    expect(ctx.entries.map((e) => [e.path, e.mode, e.reason])).toEqual([
      ['.claude/rules/style.md', 'always', 'rule'],
      ['.claude/rules/tests.md', 'lazy', 'paths-glob'],
    ]);
  });

  it('a nested CLAUDE.local.md is lazy and capped like a nested CLAUDE.md', async () => {
    const ctx = await resolve({ 'CLAUDE.md': 'root', 'pkg/CLAUDE.local.md': 'x'.repeat(50_000) });

    expect(ctx.entries.find((e) => e.path === 'pkg/CLAUDE.local.md')).toMatchObject({
      mode: 'lazy',
      reason: 'nested',
      loadedBytes: 40_000,
    });
  });

  it('with no CLAUDE.md, .claude/AGENTS.md loads too, and a nested AGENTS.md is lazy unless its directory has a CLAUDE.md', async () => {
    const ctx = await resolve({
      'AGENTS.md': 'root',
      '.claude/AGENTS.md': 'claude dir',
      'pkg/AGENTS.md': 'p'.repeat(50_000),
      'pkg/.claude/AGENTS.md': 'only read when the session starts in pkg',
      'web/AGENTS.md': 'web',
      'web/CLAUDE.md': 'web claude',
    });

    expect(ctx.entries.map((e) => [e.path, e.mode, e.reason, e.loadedBytes])).toEqual([
      ['AGENTS.md', 'always', 'agents-md-fallback', 4],
      ['.claude/AGENTS.md', 'always', 'agents-md-fallback', 10],
      ['pkg/AGENTS.md', 'lazy', 'nested-agents-md', 40_000],
      ['web/CLAUDE.md', 'lazy', 'nested', 10],
    ]);
  });

  it('a nested AGENTS.md is not loaded once a CLAUDE.md is in the chain', async () => {
    const ctx = await resolve({ 'CLAUDE.md': 'root', 'pkg/AGENTS.md': 'pkg' });

    expect(ctx.entries.map((e) => e.path)).toEqual(['CLAUDE.md']);
  });

  it('rules load from .claude/rules of the site and its parents; below the site they are lazy and capped', async () => {
    const ctx = await resolve(
      {
        '.claude/rules/style.md': 'Use tabs.',
        '.claude/rules/tests.md': `---\npaths: ["**/*.test.ts"]\n---\n${'v'.repeat(50_000)}`,
        'pkg/.claude/rules/api.md': 'Use REST.',
        'pkg/sub/.claude/rules/deep.md': 'd'.repeat(50_000),
        'other/.claude/rules/x.md': 'elsewhere',
      },
      'pkg',
    );

    expect(ctx.entries.map((e) => [e.path, e.mode, e.reason, e.loadedBytes])).toEqual([
      ['.claude/rules/style.md', 'always', 'rule', 9],
      ['pkg/.claude/rules/api.md', 'always', 'rule', 9],
      ['.claude/rules/tests.md', 'lazy', 'paths-glob', 40_000],
      ['pkg/sub/.claude/rules/deep.md', 'lazy', 'nested-rules', 40_000],
    ]);
  });

  it('skills in .claude/skills of the site and every parent are listed, below the site lazy, elsewhere not loaded', async () => {
    const ctx = await resolve(
      {
        '.claude/skills/root/SKILL.md': skill({ name: 'root', description: 'r' }),
        'other/.claude/skills/other/SKILL.md': skill({ name: 'other', description: 'o' }),
        'pkg/.claude/skills/pkg/SKILL.md': skill({ name: 'pkg', description: 'p' }),
        'pkg/sub/.claude/skills/sub/SKILL.md': skill({ name: 'sub', description: 's' }),
      },
      'pkg',
    );

    expect(ctx.entries.map((e) => [e.path, e.mode, e.reason])).toEqual([
      ['.claude/skills/root', 'listed', 'skill-catalog'],
      ['pkg/.claude/skills/pkg', 'listed', 'skill-catalog'],
      ['pkg/sub/.claude/skills/sub', 'lazy', 'nested-skills'],
    ]);
    expect(ctx.notes).toEqual([]);
  });

  it('a root skill is listed with catalogChars capped at 1536 plus its name length', async () => {
    const ctx = await resolve({
      '.claude/skills/review/SKILL.md': skill({ name: 'review', description: 'd'.repeat(2000) }),
      '.claude/skills/x/SKILL.md': skill({ name: 'x', description: 'abc', when_to_use: 'de' }),
    });

    expect(ctx.entries.map((e) => [e.path, e.mode, e.catalogChars])).toEqual([
      ['.claude/skills/review', 'listed', 6 + 1536],
      ['.claude/skills/x', 'listed', 1 + 5],
    ]);
    expect(ctx.alwaysBytes).toBe(0);
  });

  it('a disable-model-invocation skill is omitted with a note', async () => {
    const ctx = await resolve({
      '.claude/skills/deploy/SKILL.md': skill({ name: 'deploy', description: 'Deploys', 'disable-model-invocation': 'true' }),
    });

    expect(ctx.entries).toEqual([]);
    expect(ctx.notes.join('\n')).toContain('deploy');
  });

  it('an .agents/skills skill is invisible unless aliased under .claude/skills', async () => {
    const files = { '.agents/skills/x/SKILL.md': skill({ name: 'x', description: 'Does x' }) };

    const plain = await resolve(files);
    expect(plain.entries).toEqual([]);
    expect(plain.notes).toContain(
      'skill x not visible to Claude Code: .agents/skills is not scanned (anthropics/claude-code#31005)',
    );

    const mirrored = await resolve(files, '', { '.claude/skills/x': '.agents/skills/x' });
    expect(mirrored.entries.map((e) => [e.path, e.unitId, e.mode])).toEqual([
      ['.claude/skills/x', 'skill/.agents/skills/x', 'listed'],
    ]);
    expect(mirrored.notes).toEqual([]);
  });

  it('a 5 MiB CLAUDE.md is skipped with a note', async () => {
    const ctx = await resolve({ 'CLAUDE.md': 'x'.repeat(5 * 1024 * 1024) });

    expect(ctx.entries).toEqual([]);
    expect(ctx.notes.join('\n')).toMatch(/CLAUDE\.md.*4 MiB/);
  });
});
