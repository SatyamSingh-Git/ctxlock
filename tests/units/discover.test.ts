import { afterAll, describe, expect, it } from 'vitest';
import { fsReader, gitReader } from '../../src/repo/reader.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';
import { cleanup, git, gitRepo } from '../helpers/repo.js';

afterAll(cleanup);

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

  it('a nested .codex folder holds config units, since Codex reads each one from the project root down to its working directory', async () => {
    const reader = memReader({ 'pkg/api/.codex/config.toml': '', 'pkg/api/.codex/hooks.json': '{}', 'pkg/api/codex/config.toml': '' });

    expect((await discoverUnits(reader)).units.map((u) => [u.id, u.family])).toEqual([
      ['config/pkg/api/.codex/config.toml', 'codex'],
      ['config/pkg/api/.codex/hooks.json', 'codex'],
    ]);
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

  it('a CRLF copy of a file has the digest of its LF original, and keeps its own byte count', async () => {
    const lf = (await discoverUnits(memReader({ 'AGENTS.md': 'a\nb\n' }))).units[0]!;
    const crlf = (await discoverUnits(memReader({ 'AGENTS.md': 'a\r\nb\r\n' }))).units[0]!;

    expect(crlf.digest).toBe(lf.digest);
    expect([lf.files[0]!.bytes, crlf.files[0]!.bytes]).toEqual([4, 6]);
  });

  it('a core.autocrlf working tree and its git ref give a unit the same digest', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a\nb\n' }]);
    git(dir, 'config', 'core.autocrlf', 'true');
    git(dir, 'rm', '-q', '--cached', '-r', '.');
    git(dir, 'reset', '-q', '--hard');

    const tree = (await discoverUnits(fsReader(dir))).units[0]!;
    const head = (await discoverUnits(await gitReader(dir, 'HEAD'))).units[0]!;

    expect([tree.files[0]!.bytes, head.files[0]!.bytes]).toEqual([6, 4]);
    expect(tree.digest).toBe(head.digest);
  });

  it('a CLAUDE.md symlinked to a file that is not itself a unit is a unit read through the link', async () => {
    const { units } = await discoverUnits(
      memReader({ 'AGENTS.md': 'agents', 'docs/ai.md': 'shared rules' }, { 'CLAUDE.md': 'docs/ai.md' }),
    );

    expect(units.map((u) => [u.id, u.text, u.files.map((f) => f.path)])).toEqual([
      ['instructions/AGENTS.md', 'agents', ['AGENTS.md']],
      ['instructions/CLAUDE.md', 'shared rules', ['docs/ai.md']],
    ]);
  });

  it('a file symlinked into .claude/rules is a rule', async () => {
    const { units } = await discoverUnits(memReader({ 'shared/style.md': 'Use tabs.' }, { '.claude/rules/style.md': 'shared/style.md' }));

    expect(units.map((u) => [u.id, u.name, u.text])).toEqual([['rule/.claude/rules/style.md', 'style', 'Use tabs.']]);
  });

  it('a rule symlinked to AGENTS.md is a rule of its own, not an alias of the instructions', async () => {
    const { units } = await discoverUnits(memReader({ 'AGENTS.md': 'shared' }, { '.claude/rules/shared.md': 'AGENTS.md' }));

    expect(units.map((u) => [u.id, u.aliases, u.text])).toEqual([
      ['rule/.claude/rules/shared.md', [], 'shared'],
      ['instructions/AGENTS.md', [], 'shared'],
    ]);
  });

  it('a symlinked skills directory aliases the skills under its target, or makes new ones at the link', async () => {
    const { units } = await discoverUnits(
      memReader(
        { '.agents/skills/x/SKILL.md': skill('x'), '.agents/skills/y/SKILL.md': skill('y'), 'shared/z/SKILL.md': skill('z') },
        { '.claude/skills': '.agents/skills', 'pkg/.agents/skills/z': 'shared/z' },
      ),
    );

    expect(units.map((u) => [u.id, u.aliases, u.files.map((f) => f.path)])).toEqual([
      ['skill/.agents/skills/x', ['.claude/skills/x'], ['.agents/skills/x/SKILL.md']],
      ['skill/.agents/skills/y', ['.claude/skills/y'], ['.agents/skills/y/SKILL.md']],
      ['skill/pkg/.agents/skills/z', [], ['shared/z/SKILL.md']],
    ]);
  });

  it('a .claude/rules file in a subdirectory is a rule', async () => {
    const { units } = await discoverUnits(memReader({ 'pkg/.claude/rules/api/style.md': 'Use REST.' }));

    expect(units.map((u) => [u.id, u.name])).toEqual([['rule/pkg/.claude/rules/api/style.md', 'style']]);
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

  describe('knowledge and metric units', () => {
    const concept = (type: string, title?: string) => `---\ntype: ${type}\n${title ? `title: ${title}\n` : ''}---\n# Body\n`;
    const ids = (units: Array<{ id: string }>) => units.map((u) => u.id);

    it('a bundle declared by okf_version, or in ctxlock.yaml, makes each concept a knowledge unit, and index.md and log.md are not concepts', async () => {
      const reader = memReader({
        'kb/index.md': '---\nokf_version: "0.2"\n---\n# Index\n',
        'kb/metrics/nrr.md': concept('Metric', 'Net revenue retention'),
        'kb/log.md': '# Log\n',
        'kb/metrics/index.md': '# Metrics\n',
        'other/a.md': concept('Reference'),
        'other/sub/b.md': concept('Reference'),
        'other/data.csv': 'a,b',
      });
      const { units } = await discoverUnits(reader, { knowledge: ['other'], metrics: [] });

      expect(ids(units)).toEqual(['knowledge/kb/metrics/nrr.md', 'knowledge/other/a.md', 'knowledge/other/sub/b.md']);
      const nrr = units.find((u) => u.id === 'knowledge/kb/metrics/nrr.md')!;
      expect(nrr).toMatchObject({ kind: 'knowledge', family: 'okf', name: 'Net revenue retention', frontmatter: { type: 'Metric' }, body: '# Body\n' });
      expect(units.find((u) => u.id === 'knowledge/other/a.md')!.name).toBe('a');
    });

    it('a docs folder with type: in its frontmatter is not knowledge until declared', async () => {
      const files = { 'docs/guide.md': concept('docs'), 'docs/index.md': '---\ntitle: Docs\n---\n' };
      expect(ids((await discoverUnits(memReader(files))).units)).toEqual([]);
      expect(ids((await discoverUnits(memReader(files), { knowledge: ['docs'], metrics: [] })).units)).toEqual(['knowledge/docs/guide.md']);
    });

    it('an *.ossie.yaml file, or a file ctxlock.yaml lists, is a metric unit named by its model', async () => {
      const reader = memReader({
        'models/sales.ossie.yaml': 'version: 0.3.0.dev0\nname: sales_analytics\ndatasets: []\n',
        // An Ossie model may be JSON, which YAML 1.2 reads too.
        'models/b.ossie.json': '{\n\t"version": "0.3.0.dev0",\n\t"name": "b_model",\n\t"datasets": []\n}',
        'semantic/x.yaml': 'version: 0.3.0.dev0\nname: x_model\ndatasets: []\n',
        'semantic/notes.md': 'not a model',
        'semantic/broken.yaml': 'name: [unclosed\n',
        'single.yml': 'name: single\n',
        'config/other.yaml': 'name: not_a_model\n',
      });
      const { units } = await discoverUnits(reader, { knowledge: [], metrics: ['semantic', 'single.yml'] });

      expect(ids(units)).toEqual(['metric/models/b.ossie.json', 'metric/models/sales.ossie.yaml', 'metric/semantic/broken.yaml', 'metric/semantic/x.yaml', 'metric/single.yml']);
      expect(units.map((u) => u.name)).toEqual(['b_model', 'sales_analytics', 'broken.yaml', 'x_model', 'single']);
      expect(units[1]).toMatchObject({ kind: 'metric', family: 'ossie', frontmatter: null });
    });

    it('a bundle at the repository root, by okf_version or knowledge: ["."], makes every .md a concept', async () => {
      const files = { 'index.md': '---\nokf_version: "0.2"\n---\n', 'nrr.md': concept('Metric'), 'm/arr.md': concept('Metric'), 'AGENTS.md': 'Use pnpm.\n' };
      const expected = ['instructions/AGENTS.md', 'knowledge/m/arr.md', 'knowledge/nrr.md'];
      expect(ids((await discoverUnits(memReader(files))).units)).toEqual(expected);
      const { 'index.md': _, ...undeclared } = files;
      expect(ids((await discoverUnits(memReader(undeclared))).units)).toEqual(['instructions/AGENTS.md']);
      expect(ids((await discoverUnits(memReader(undeclared), { knowledge: ['.'], metrics: [] })).units)).toEqual(expected);
      expect(ids((await discoverUnits(memReader({ 'a.yaml': 'name: a\n', 'b.json': '{}' }), { knowledge: [], metrics: ['.'] })).units)).toEqual(['metric/a.yaml', 'metric/b.json']);
    });

    it('every index.md is read in one batch, so a docs site costs one git process, not one per page', async () => {
      const pages = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`site/p${i}/index.md`, `---\ntitle: Page ${i}\n---\n`]));
      const reader = memReader({ ...pages, 'kb/index.md': '---\nokf_version: "0.2"\n---\n', 'kb/a.md': concept('Reference') });
      expect(ids((await discoverUnits(reader)).units)).toEqual(['knowledge/kb/a.md']);
      expect(reader.batches).toBe(1);
      // The six index files in the batch, and the concept read as a unit.
      expect(reader.reads).toBe(7);
      const none = memReader({ 'AGENTS.md': 'x' });
      await discoverUnits(none);
      expect(none.batches).toBe(0);
    });

    it('a rule inside a declared bundle stays a rule', async () => {
      const { units } = await discoverUnits(memReader({ '.claude/rules/kb/x.md': concept('Reference') }), { knowledge: ['.claude/rules'], metrics: [] });
      expect(ids(units)).toEqual(['rule/.claude/rules/kb/x.md']);
    });

    it('knowledge frontmatter that does not parse is an L0-frontmatter must', async () => {
      const { units, problems } = await discoverUnits(memReader({ 'kb/x.md': '---\ntype: [\n---\n' }), { knowledge: ['kb'], metrics: [] });
      expect(ids(units)).toEqual(['knowledge/kb/x.md']);
      expect(problems).toMatchObject([{ rule: 'L0-frontmatter', severity: 'must', unitId: 'knowledge/kb/x.md' }]);
    });
  });

  // Paths and their sources: the-guide/other-agents.md.
  describe("other agents' files", () => {
    const one = async (path: string, text = 'Use pnpm.\n') => (await discoverUnits(memReader({ [path]: text }))).units.map((u) => [u.id, u.family]);

    it.each([
      ['.github/copilot-instructions.md', 'instructions/.github/copilot-instructions.md', 'copilot'],
      ['.github/instructions/api/routes.instructions.md', 'rule/.github/instructions/api/routes.instructions.md', 'copilot'],
      ['.cursor/rules/api/routes.mdc', 'rule/.cursor/rules/api/routes.mdc', 'cursor'],
      ['.cursorrules', 'instructions/.cursorrules', 'cursor'],
      ['.cursor/skills/x/SKILL.md', 'skill/.cursor/skills/x', 'cursor'],
      ['GEMINI.md', 'instructions/GEMINI.md', 'gemini'],
      ['pkg/GEMINI.md', 'instructions/pkg/GEMINI.md', 'gemini'],
      ['.agents/rules/style.md', 'rule/.agents/rules/style.md', 'antigravity'],
      ['.devin/global_rules.md', 'instructions/.devin/global_rules.md', 'devin'],
      ['.devin/rules/style.md', 'rule/.devin/rules/style.md', 'devin'],
      ['.devin/skills/x/SKILL.md', 'skill/.devin/skills/x', 'devin'],
      ['.windsurfrules', 'instructions/.windsurfrules', 'devin'],
      ['.windsurf/global_rules.md', 'instructions/.windsurf/global_rules.md', 'devin'],
      ['.windsurf/rules/style.md', 'rule/.windsurf/rules/style.md', 'devin'],
      ['.windsurf/skills/x/SKILL.md', 'skill/.windsurf/skills/x', 'devin'],
      ['.kiro/steering/style.md', 'rule/.kiro/steering/style.md', 'kiro'],
      ['.clinerules', 'instructions/.clinerules', 'cline'],
      ['.clinerules/style.md', 'rule/.clinerules/style.md', 'cline'],
      ['.clinerules/skills/x/SKILL.md', 'skill/.clinerules/skills/x', 'cline'],
      ['.cline/rules/style.md', 'rule/.cline/rules/style.md', 'cline'],
      ['.cline/skills/x/SKILL.md', 'skill/.cline/skills/x', 'cline'],
      ['.opencode/skills/x/SKILL.md', 'skill/.opencode/skills/x', 'opencode'],
      ['.kilo/skills/x/SKILL.md', 'skill/.kilo/skills/x', 'opencode'],
      ['.kilocode/rules/style.md', 'rule/.kilocode/rules/style.md', 'opencode'],
      ['.junie/guidelines.md', 'instructions/.junie/guidelines.md', 'junie'],
      ['.junie/guidelines/style.md', 'rule/.junie/guidelines/style.md', 'junie'],
      ['.junie/rules/style.md', 'rule/.junie/rules/style.md', 'junie'],
      ['.junie/playbook.md', 'instructions/.junie/playbook.md', 'junie'],
      ['AGENT.md', 'instructions/AGENT.md', 'other'],
      ['pkg/AGENTS.local.md', 'instructions/pkg/AGENTS.local.md', 'other'],
      ['.github/skills/x/SKILL.md', 'skill/.github/skills/x', 'copilot'],
      ['.gemini/skills/x/SKILL.md', 'skill/.gemini/skills/x', 'gemini'],
      ['.kiro/skills/x/SKILL.md', 'skill/.kiro/skills/x', 'kiro'],
      ['.junie/skills/x/SKILL.md', 'skill/.junie/skills/x', 'junie'],
      ['.opencode/skill/x/SKILL.md', 'skill/.opencode/skill/x', 'opencode'],
      ['.agent/rules/style.md', 'rule/.agent/rules/style.md', 'antigravity'],
      ['_agents/rules/style.md', 'rule/_agents/rules/style.md', 'antigravity'],
      ['.clinerules/notes.txt', 'rule/.clinerules/notes.txt', 'cline'],
      ['.kilo/rules/style.md', 'rule/.kilo/rules/style.md', 'opencode'],
      ['.kilocoderules', 'instructions/.kilocoderules', 'opencode'],
      // Execution config, parsed or opaque (Task 3).
      ['.github/workflows/copilot-setup-steps.yml', 'config/.github/workflows/copilot-setup-steps.yml', 'copilot'],
      ['.github/hooks/guard.json', 'config/.github/hooks/guard.json', 'copilot'],
      ['.github/mcp.json', 'config/.github/mcp.json', 'copilot'],
      ['.github/copilot/settings.json', 'config/.github/copilot/settings.json', 'copilot'],
      ['.vscode/mcp.json', 'config/.vscode/mcp.json', 'copilot'],
      ['.cursor/mcp.json', 'config/.cursor/mcp.json', 'cursor'],
      ['.cursor/hooks.json', 'config/.cursor/hooks.json', 'cursor'],
      ['.gemini/settings.json', 'config/.gemini/settings.json', 'gemini'],
      ['.agents/hooks.json', 'config/.agents/hooks.json', 'antigravity'],
      ['.agents/mcp_config.json', 'config/.agents/mcp_config.json', 'antigravity'],
      ['.agents/plugins/p/plugin.json', 'config/.agents/plugins/p/plugin.json', 'antigravity'],
      ['.agents/plugins/p/hooks.json', 'config/.agents/plugins/p/hooks.json', 'antigravity'],
      ['.devin/hooks.v1.json', 'config/.devin/hooks.v1.json', 'devin'],
      ['.devin/mcp_config.json', 'config/.devin/mcp_config.json', 'devin'],
      ['.devin/config.json', 'config/.devin/config.json', 'devin'],
      ['.kiro/hooks/lint.json', 'config/.kiro/hooks/lint.json', 'kiro'],
      ['.kiro/settings/mcp.json', 'config/.kiro/settings/mcp.json', 'kiro'],
      ['.kiro/agents/reviewer.json', 'config/.kiro/agents/reviewer.json', 'kiro'],
      ['.clinerules/hooks/PreToolUse', 'config/.clinerules/hooks/PreToolUse', 'cline'],
      ['.cline/hooks/PreToolUse.sh', 'config/.cline/hooks/PreToolUse.sh', 'cline'],
      ['.cline/plugins/audit.js', 'config/.cline/plugins/audit.js', 'cline'],
      ['opencode.json', 'config/opencode.json', 'opencode'],
      ['pkg/opencode.jsonc', 'config/pkg/opencode.jsonc', 'opencode'],
      ['.opencode/opencode.json', 'config/.opencode/opencode.json', 'opencode'],
      ['.opencode/plugins/audit.ts', 'config/.opencode/plugins/audit.ts', 'opencode'],
      ['.opencode/tool/run.js', 'config/.opencode/tool/run.js', 'opencode'],
      ['kilo.jsonc', 'config/kilo.jsonc', 'opencode'],
      ['.kilo/mcp.json', 'config/.kilo/mcp.json', 'opencode'],
      ['.kilocode/mcp.json', 'config/.kilocode/mcp.json', 'opencode'],
      ['.kilo/plugins/audit.ts', 'config/.kilo/plugins/audit.ts', 'opencode'],
      ['.junie/mcp/mcp.json', 'config/.junie/mcp/mcp.json', 'junie'],
      ['.junie/config.json', 'config/.junie/config.json', 'junie'],
    ])('%s is %s, of family %s', async (path, id, family) => {
      expect(await one(path, path.endsWith('SKILL.md') ? skill('x') : 'Use pnpm.\n')).toEqual([[id, family]]);
    });

    it("matches other agents' config in any case, as Windows and macOS read it", async () => {
      expect(await one('.Cursor/mcp.json', '{}')).toEqual([['config/.Cursor/mcp.json', 'cursor']]);
      expect(await one('.GITHUB/hooks/guard.json', '{}')).toEqual([['config/.GITHUB/hooks/guard.json', 'copilot']]);
    });

    it.each([
      '.cursor/rules/x.md',
      '.github/skills/a/b/SKILL.md',
      '.github/instructions/x.md',
      '.github/workflows/ci.yml',
      '.github/workflows/copilot-setup-steps.yaml',
      '.agents/rules/sub/x.txt',
      '.windsurf/mcp_config.json',
      '.clinerules/skills/x/reference.md',
    ])(
      '%s is not a unit',
      async (path) => {
        expect(await one(path)).toEqual([]);
      },
    );

    it("a modelled path wins: a .claude link to another agent's file keeps today's unit, and a link the other way stays an alias", async () => {
      const today = async (files: Record<string, string>, links: Record<string, string>) =>
        (await discoverUnits(memReader(files, links))).units.map((u) => [u.id, u.family, u.aliases]);

      expect(await today({ '.github/skills/x/SKILL.md': skill('x') }, { '.claude/skills/x': '.github/skills/x' })).toEqual([['skill/.claude/skills/x', 'claude', []]]);
      expect(await today({ '.cursor/rules/r.mdc': 'r' }, { '.claude/rules/r.md': '.cursor/rules/r.mdc' })).toEqual([['rule/.claude/rules/r.md', 'claude', []]]);
      // As before this change, any link to a unit is an alias, so imports through it resolve.
      expect(await today({ '.claude/skills/x/SKILL.md': skill('x') }, { '.github/skills/x': '.claude/skills/x' })).toEqual([['skill/.claude/skills/x', 'claude', ['.github/skills/x']]]);
    });

    it('a .mdc rule may be empty or have no frontmatter, and a rule that is not UTF-8 is an L0-encoding problem', async () => {
      const { units, problems } = await discoverUnits(
        memReader({ '.cursor/rules/empty.mdc': '', '.cursor/rules/plain.mdc': 'Use pnpm.\n', '.cursor/rules/latin1.mdc': Buffer.from([0x63, 0x61, 0x66, 0xe9]) }),
      );

      expect(units.map((u) => u.id)).toEqual(['rule/.cursor/rules/empty.mdc', 'rule/.cursor/rules/latin1.mdc', 'rule/.cursor/rules/plain.mdc']);
      expect(problems.map((p) => [p.rule, p.path])).toEqual([['L0-encoding', '.cursor/rules/latin1.mdc']]);
    });
  });
});
