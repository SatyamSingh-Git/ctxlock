import { describe, expect, it } from 'vitest';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

const skill = (name: string, description = 'Does a thing') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

describe('discoverUnits', () => {
  it('discovers each convention as the right kind and family', async () => {
    const reader = memReader({
      'AGENTS.md': 'root',
      'pkg/AGENTS.override.md': 'override',
      'CLAUDE.md': 'claude',
      '.claude/CLAUDE.md': 'claude dir',
      'sub/CLAUDE.local.md': 'local',
      '.claude/rules/testing.md': '---\npaths: ["**/*.test.ts"]\n---\nUse vitest.\n',
      '.claude/skills/review/SKILL.md': skill('review'),
      '.agents/skills/release-notes/SKILL.md': skill('release-notes'),
      '.claude/settings.json': '{}',
      '.claude/settings.local.json': '{}',
      '.mcp.json': '{}',
      '.codex/config.toml': '',
      '.codex/hooks.json': '{}',
      '.vscode/settings.json': '{}',
      'README.md': 'not context',
      'src/index.ts': 'export {}',
      '.claude/agents/x.md': 'not a pattern',
    });

    const { units } = await discoverUnits(reader);

    expect(units.map((u) => [u.id, u.family])).toEqual([
      ['skill/.agents/skills/release-notes', 'agents'],
      ['instructions/.claude/CLAUDE.md', 'claude'],
      ['rule/.claude/rules/testing.md', 'claude'],
      ['config/.claude/settings.json', 'claude'],
      ['config/.claude/settings.local.json', 'claude'],
      ['skill/.claude/skills/review', 'claude'],
      ['config/.codex/config.toml', 'codex'],
      ['config/.codex/hooks.json', 'codex'],
      ['config/.mcp.json', 'claude'],
      ['config/.vscode/settings.json', 'vscode'],
      ['instructions/AGENTS.md', 'agents-md'],
      ['instructions/CLAUDE.md', 'claude'],
      ['instructions/pkg/AGENTS.override.md', 'agents-md'],
      ['instructions/sub/CLAUDE.local.md', 'claude'],
    ]);
    expect(units.find((u) => u.kind === 'rule')?.name).toBe('testing');
    expect(units.find((u) => u.id === 'skill/.agents/skills/release-notes')?.name).toBe('release-notes');
  });

  it('skill digest changes when a script inside the skill changes, and not when a file outside it changes', async () => {
    const base = { '.agents/skills/s/SKILL.md': skill('s'), '.agents/skills/s/scripts/run.sh': 'echo 1', 'README.md': 'a' };
    const digestOf = async (files: Record<string, string>) =>
      (await discoverUnits(memReader(files))).units.find((u) => u.kind === 'skill')!.digest;

    const original = await digestOf(base);
    expect(await digestOf({ ...base, '.agents/skills/s/scripts/run.sh': 'echo 2' })).not.toBe(original);
    expect(await digestOf({ ...base, 'README.md': 'b' })).toBe(original);
  });

  it('invalid YAML frontmatter becomes an L0-frontmatter problem, must for skills and should for rules, and does not throw', async () => {
    const broken = '---\nname: [unclosed\n---\nbody\n';
    const { units, problems } = await discoverUnits(
      memReader({ '.agents/skills/x/SKILL.md': broken, '.claude/rules/r.md': broken }),
    );

    expect(problems.map((p) => [p.rule, p.severity, p.path])).toEqual([
      ['L0-frontmatter', 'must', '.agents/skills/x/SKILL.md'],
      ['L0-frontmatter', 'should', '.claude/rules/r.md'],
    ]);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.frontmatter === null)).toBe(true);
  });

  it('does not parse a leading markdown rule in AGENTS.md as frontmatter', async () => {
    const { units, problems } = await discoverUnits(memReader({ 'AGENTS.md': '---\n# Title: [x\n---\nText\n' }));

    expect(problems).toEqual([]);
    expect(units[0]!.frontmatter).toBeNull();
  });

  it('a non-UTF-8 file becomes an L0-encoding should problem with empty text', async () => {
    const { units, problems } = await discoverUnits(memReader({ 'AGENTS.md': Buffer.from([0xff, 0xfe, 0x41]) }));

    expect(problems.map((p) => [p.rule, p.severity, p.path])).toEqual([['L0-encoding', 'should', 'AGENTS.md']]);
    expect(units[0]!.text).toBe('');
    expect(units[0]!.files[0]!.bytes).toBe(3);
  });

  it('an empty AGENTS.md is a unit with empty text and a digest', async () => {
    const { units, problems } = await discoverUnits(memReader({ 'AGENTS.md': '' }));

    expect(problems).toEqual([]);
    expect(units[0]!.text).toBe('');
    expect(units[0]!.files[0]!.bytes).toBe(0);
    expect(units[0]!.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('a symlinked skill directory becomes an alias of its target, not a second unit', async () => {
    const { units } = await discoverUnits(
      memReader({ '.agents/skills/x/SKILL.md': skill('x') }, { '.claude/skills/x': '.agents/skills/x' }),
    );

    expect(units.map((u) => [u.id, u.aliases])).toEqual([['skill/.agents/skills/x', ['.claude/skills/x']]]);
  });

  it('a CLAUDE.md symlink to AGENTS.md becomes an alias of AGENTS.md', async () => {
    const { units } = await discoverUnits(memReader({ 'AGENTS.md': 'shared' }, { 'CLAUDE.md': 'AGENTS.md' }));

    expect(units.map((u) => [u.id, u.aliases])).toEqual([['instructions/AGENTS.md', ['CLAUDE.md']]]);
  });

  it('a symlink leaving the repo is not followed and becomes an L0-symlink-outside info problem', async () => {
    const { units, problems } = await discoverUnits(memReader({}, { '.claude/skills/evil': null }));

    expect(units).toEqual([]);
    expect(problems.map((p) => [p.rule, p.severity, p.path])).toEqual([
      ['L0-symlink-outside', 'info', '.claude/skills/evil'],
    ]);
  });

  it('discovery reads only candidate files', async () => {
    const files: Record<string, string> = {
      'AGENTS.md': 'a',
      '.claude/rules/a.md': 'rule',
      '.agents/skills/s/SKILL.md': skill('s'),
      '.agents/skills/s/scripts/x.sh': 'echo',
    };
    for (let i = 0; i < 20_000; i++) files[`src/f${i}.ts`] = 'x';
    const reader = memReader(files);

    await discoverUnits(reader);

    expect(reader.reads).toBe(4);
  });
});
