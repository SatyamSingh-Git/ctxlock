import { afterAll, describe, expect, it } from 'vitest';
import { GENERATED_FILE, serializeGenerated } from '../../src/build/generated.js';
import { planFill } from '../../src/build/plan.js';
import { gitIgnored } from '../../src/repo/gitignore.js';
import { fsReader } from '../../src/repo/reader.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest, sha256Hex } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';
import { cleanup, gitRepo, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

async function plan(files: Record<string, string | Buffer>, symlinks: Record<string, string | null> = {}) {
  const reader = memReader(files, symlinks);
  return planFill(await scanRepo(reader, { today: '2026-11-07' }), reader, async () => new Set());
}

// A plan for a real git repository, asking git which paths it ignores.
async function planInGit(files: Record<string, string>, exclude = '') {
  const { dir } = await gitRepo([files]);
  writeTree(dir, { '.git/info/exclude': exclude });
  const reader = fsReader(dir, { local: false });
  return planFill(await scanRepo(reader, { today: '2026-11-07' }), reader, (paths) => gitIgnored(dir, paths));
}

const SKILL = '---\nname: release\ndescription: Releases the project\n---\nRun scripts/run.sh.\n';
const RUN = Buffer.from('echo one\r\necho two\r\n');
const source = (path: string, content: string | Buffer) => ({ path, sha256: lfDigest(Buffer.from(content)) });

describe('planFill: skill-copy', () => {
  it('copies a skill only Codex reaches into .claude/skills, byte for byte, each file from its own source', async () => {
    const p = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': RUN });

    expect(p.actions).toEqual([
      {
        kind: 'skill-copy',
        harness: 'claude-code',
        target: '.claude/skills/release',
        files: [
          { path: '.claude/skills/release/SKILL.md', bytes: Buffer.from(SKILL), from: [source('.agents/skills/release/SKILL.md', SKILL)] },
          { path: '.claude/skills/release/scripts/run.sh', bytes: RUN, from: [source('.agents/skills/release/scripts/run.sh', RUN)] },
        ],
      },
    ]);
    expect(p.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: '.claude/skills/release', reason: 'a copy of the skill' }]);
  });

  it('leaves a gap when the mirror is taken, and none when a symlink already shows the skill to both agents', async () => {
    const taken = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.claude/skills/release/SKILL.md': SKILL.replace('Releases', 'Ships') });
    expect(taken.actions).toEqual([]);
    expect(taken.gaps).toContainEqual({ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release exists' });

    expect(await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL }, { '.claude/skills/release': '.agents/skills/release' })).toEqual({ actions: [], gaps: [] });
  });

  it('never fills a path git ignores, by any rule git reads, where the file could not be committed', async () => {
    const p = await planInGit({ '.gitignore': '.agents\n', 'AGENTS.md': 'a', '.claude/skills/release/SKILL.md': SKILL });
    expect(p.actions).toEqual([]);
    expect(p.gaps).toEqual([{ path: '.claude/skills/release', harness: 'codex', fill: null, reason: '.agents/skills/release/SKILL.md is gitignored' }]);

    const nested = await planInGit({ 'src/.gitignore': 'api/\n', 'AGENTS.md': 'a', '.claude/rules/api.md': '---\npaths: ["src/api/**"]\n---\nAPI.\n' });
    expect(nested.gaps).toEqual([{ path: '.claude/rules/api.md', harness: 'codex', fill: null, reason: 'src/api/AGENTS.md is gitignored' }]);

    // Some teams keep CLAUDE.md out of git, apart from the one at the root.
    const claude = await planInGit({ '.gitignore': 'pkg/CLAUDE.md\n', 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.md': 'a', 'pkg/AGENTS.md': 'p' });
    expect(claude.actions.filter((a) => a.kind === 'claude-import')).toEqual([]);
    expect(claude.gaps).toContainEqual({ path: 'pkg/AGENTS.md', harness: 'claude-code', fill: null, reason: 'pkg/CLAUDE.md is gitignored' });

    // Not only .gitignore files: .git/info/exclude, and a pattern that matches one file of a copy.
    const excluded = await planInGit({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL }, '.claude/\n');
    expect(excluded.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release/SKILL.md is gitignored' }]);
    const script = await planInGit({ '.gitignore': '.claude/**/*.sh\n', 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': 'echo\n' });
    expect(script.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release/scripts/run.sh is gitignored' }]);
  });

  it('fills nothing when the record of what it generated would be gitignored', async () => {
    const p = await planInGit({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, 'CLAUDE.md': 'Use pnpm.\n' }, '.ctxlock/\n');
    expect(p.actions).toEqual([]);
    expect(p.gaps).toEqual([
      { path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.ctxlock/generated.json is gitignored' },
      { path: 'AGENTS.md', harness: 'claude-code', fill: null, reason: 'edit by hand: add @AGENTS.md to CLAUDE.md' },
      { path: 'CLAUDE.md', harness: 'codex', fill: null, reason: '.ctxlock/generated.json is gitignored' },
    ]);
  });

  it('leaves a skill with files reached through a symlink to be copied by hand, since their paths are not under it', async () => {
    const p = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, 'tools/run.sh': RUN }, { '.agents/skills/release/scripts': 'tools' });
    expect(p.actions).toEqual([]);
    expect(p.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: 'files reached through a symlink; copy by hand' }]);

    // A folder beside it whose name starts the same is still outside it.
    const sibling = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release-tools/run.sh': RUN }, { '.agents/skills/release/scripts': '.agents/skills/release-tools' });
    expect(sibling.gaps).toEqual(p.gaps);
  });

  it('never writes through a symlink at the mirror, such as one that leaves the repository', async () => {
    const p = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL }, { '.claude/skills': null });
    expect(p.actions).toEqual([]);
    expect(p.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release exists' }]);
  });
});

describe('planFill: claude-import', () => {
  it('creates a CLAUDE.md that imports an AGENTS.md Claude Code skips, where the folder has none', async () => {
    const p = await plan({ 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.md': 'a', 'packages/api/AGENTS.md': 'api' });

    expect(p.actions).toEqual([{ kind: 'claude-import', harness: 'claude-code', target: 'packages/api/CLAUDE.md', files: [{ path: 'packages/api/CLAUDE.md', bytes: Buffer.from('@AGENTS.md\n'), from: [] }] }]);
    expect(p.gaps).toContainEqual({ path: 'packages/api/AGENTS.md', harness: 'claude-code', fill: 'packages/api/CLAUDE.md', reason: 'a CLAUDE.md that imports it' });
    expect(p.gaps).toContainEqual({ path: 'AGENTS.md', harness: 'claude-code', fill: null, reason: 'edit by hand: add @AGENTS.md to CLAUDE.md' });
  });

  it('leaves the edit to a person when the folder has its own CLAUDE.md', async () => {
    const p = await plan({ 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.md': 'a', 'packages/api/AGENTS.md': 'api', 'packages/api/CLAUDE.md': 'Notes.\n' });
    expect(p.actions.filter((a) => a.kind === 'claude-import')).toEqual([]);
    expect(p.gaps).toContainEqual({ path: 'packages/api/AGENTS.md', harness: 'claude-code', fill: null, reason: 'edit by hand: add @AGENTS.md to packages/api/CLAUDE.md' });
  });
});

describe('planFill: agents-md', () => {
  it('assembles AGENTS.md from what Claude Code loads in the folder: CLAUDE.md, its imports, then unscoped rules', async () => {
    const files = { 'CLAUDE.md': 'Use pnpm.\n\n@docs/testing.md\n', 'docs/testing.md': 'Run pnpm test.\n', '.claude/rules/style.md': 'Use tabs.\n' };
    const p = await plan(files);

    expect(p.actions).toEqual([
      {
        kind: 'agents-md',
        harness: 'codex',
        target: 'AGENTS.md',
        files: [
          {
            path: 'AGENTS.md',
            bytes: Buffer.from('Use pnpm.\n\n@docs/testing.md\n\nRun pnpm test.\n\nUse tabs.\n'),
            from: [source('CLAUDE.md', files['CLAUDE.md']), source('docs/testing.md', files['docs/testing.md']), source('.claude/rules/style.md', files['.claude/rules/style.md'])],
          },
        ],
      },
    ]);
    expect(p.gaps).toEqual([
      { path: '.claude/rules/style.md', harness: 'codex', fill: 'AGENTS.md', reason: 'an AGENTS.md from what Claude Code loads there' },
      { path: 'CLAUDE.md', harness: 'codex', fill: 'AGENTS.md', reason: 'an AGENTS.md from what Claude Code loads there' },
    ]);
  });

  it('writes no AGENTS.md where one exists, and points at it instead', async () => {
    const p = await plan({ 'CLAUDE.md': 'Use pnpm.\n\n@AGENTS.md\n', 'AGENTS.md': 'a', '.claude/rules/style.md': 'Use tabs.\n' });
    expect(p.actions).toEqual([]);
    expect(p.gaps).toContainEqual({ path: '.claude/rules/style.md', harness: 'codex', fill: null, reason: 'add it to AGENTS.md by hand' });
  });

  it('writes AGENTS.md with LF line endings when its sources were checked out with CRLF', async () => {
    const p = await plan({ 'CLAUDE.md': 'Use pnpm.\r\n\r\n@docs/testing.md\r\n', 'docs/testing.md': 'Run pnpm test.\r\nThen lint.\r\n' });
    expect(p.actions[0]!.files[0]!.bytes.toString('utf8')).toBe('Use pnpm.\n\n@docs/testing.md\n\nRun pnpm test.\nThen lint.\n');
  });

  it('puts each file in once when imports go round in a circle', async () => {
    const p = await plan({ 'CLAUDE.md': '@a.md\n', 'a.md': 'A @b.md\n', 'b.md': 'B @a.md\n' });
    expect(p.actions[0]!.files[0]!.bytes.toString('utf8')).toBe('@a.md\n\nA @b.md\n\nB @a.md\n');
  });

  it('follows imports as far as Claude Code does, four hops', async () => {
    const chain = { 'CLAUDE.md': '@a1.md\n', 'a1.md': '1 @a2.md\n', 'a2.md': '2 @a3.md\n', 'a3.md': '3 @a4.md\n', 'a4.md': '4 @a5.md\n', 'a5.md': '5\n' };
    const p = await plan(chain);
    expect(p.actions[0]!.files[0]!.from.map((s) => s.path)).toEqual(['CLAUDE.md', 'a1.md', 'a2.md', 'a3.md', 'a4.md']);
  });

  it('leaves a folder with AGENTS.override.md to a person, and never counts CLAUDE.local.md', async () => {
    const override = await plan({ 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.override.md': 'o' });
    expect(override.actions).toEqual([]);
    expect(override.gaps).toContainEqual({ path: 'CLAUDE.md', harness: 'codex', fill: null, reason: 'add it to AGENTS.override.md by hand' });

    const local = await plan({ 'AGENTS.md': 'a', 'CLAUDE.local.md': 'mine' });
    expect(local.gaps.map((g) => g.path)).not.toContain('CLAUDE.local.md');
    expect(local.actions.map((a) => a.target)).toEqual(['CLAUDE.md']);
  });

  it('skips a CLAUDE.md that only imports AGENTS.md', async () => {
    expect(await plan({ 'CLAUDE.md': '@AGENTS.md\n' })).toEqual({ actions: [], gaps: [] });
  });

  it('gives a folder-scoped rule its own AGENTS.md, and leaves other globs as gaps', async () => {
    const rule = '---\npaths: ["src/api/**"]\n---\nAPI rules.\n';
    const scoped = await plan({ 'AGENTS.md': 'a', '.claude/rules/api.md': rule });
    expect(scoped.actions).toEqual([
      { kind: 'agents-md', harness: 'codex', target: 'src/api/AGENTS.md', files: [{ path: 'src/api/AGENTS.md', bytes: Buffer.from('API rules.\n'), from: [source('.claude/rules/api.md', rule)] }] },
    ]);

    const anywhere = await plan({ 'AGENTS.md': 'a', '.claude/rules/ts.md': '---\npaths: ["**/*.ts"]\n---\nTypes.\n' });
    expect(anywhere.actions).toEqual([]);
    expect(anywhere.gaps).toEqual([{ path: '.claude/rules/ts.md', harness: 'codex', fill: null, reason: 'Codex cannot scope **/*.ts' }]);

    const outside = await plan({ 'AGENTS.md': 'a', '.claude/rules/up.md': '---\npaths: ["../other/**"]\n---\nUp.\n' });
    expect(outside.gaps).toEqual([{ path: '.claude/rules/up.md', harness: 'codex', fill: null, reason: 'Codex cannot scope ../other/**' }]);

    const empty = await plan({ 'AGENTS.md': 'a', '.claude/rules/none.md': '---\npaths: []\n---\nNone.\n' });
    expect(empty).toEqual({ actions: [], gaps: [{ path: '.claude/rules/none.md', harness: 'codex', fill: null, reason: 'Codex cannot scope paths: []' }] });

    // A folder that is absolute, on a drive, or inside .git is no folder of the repository to write in.
    for (const pattern of ['/src/**', 'C:/x/**', '.git/**', 'pkg/.git/**']) {
      const p = await plan({ 'AGENTS.md': 'a', '.claude/rules/r.md': `---\npaths: ["${pattern}"]\n---\nR.\n` });
      expect(p, pattern).toEqual({ actions: [], gaps: [{ path: '.claude/rules/r.md', harness: 'codex', fill: null, reason: `Codex cannot scope ${pattern}` }] });
    }
  });
});

describe('planFill: what is generated already', () => {
  const v1 = SKILL;
  const v2 = SKILL.replace('Run', 'Then run');
  const record = serializeGenerated([{ path: '.claude/skills/release/SKILL.md', sha256: sha256Hex(v1), from: [source('.agents/skills/release/SKILL.md', v1)] }]);

  it('regenerates a stale copy nobody edited, and leaves an edited one alone', async () => {
    const stale = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': v2, '.claude/skills/release/SKILL.md': v1, [GENERATED_FILE]: record });
    expect(stale.actions.map((a) => [a.target, a.files[0]!.bytes.toString('utf8')])).toEqual([['.claude/skills/release', v2]]);

    const edited = await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': v2, '.claude/skills/release/SKILL.md': 'mine', [GENERATED_FILE]: record });
    expect(edited.actions).toEqual([]);
    expect(edited.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release exists' }]);
  });

  it('removes a file from a copy once its source skill no longer has it, unless someone edited it', async () => {
    const two = serializeGenerated([
      { path: '.claude/skills/release/SKILL.md', sha256: sha256Hex(v1), from: [source('.agents/skills/release/SKILL.md', v1)] },
      { path: '.claude/skills/release/old.sh', sha256: sha256Hex('old'), from: [source('.agents/skills/release/old.sh', 'old')] },
    ]);
    const files = { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': v1, '.claude/skills/release/SKILL.md': v1, '.claude/skills/release/old.sh': 'old', [GENERATED_FILE]: two };
    const p = await plan(files);
    expect(p.actions.map((a) => [a.target, a.remove])).toEqual([['.claude/skills/release', ['.claude/skills/release/old.sh']]]);

    const edited = await plan({ ...files, '.claude/skills/release/old.sh': 'mine' });
    expect(edited.actions).toEqual([]);
    expect(edited.gaps).toEqual([{ path: '.agents/skills/release', harness: 'claude-code', fill: null, reason: '.claude/skills/release exists' }]);
  });

  it('plans nothing when every target is up to date', async () => {
    expect(await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': v1, '.claude/skills/release/SKILL.md': v1, [GENERATED_FILE]: record })).toEqual({ actions: [], gaps: [] });
  });

  it('plans nothing for a target that differs from what it would write only in CRLF line endings, as a Windows checkout has it', async () => {
    const crlf = v1.replaceAll('\n', '\r\n');
    expect(await plan({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': crlf, '.claude/skills/release/SKILL.md': v1, [GENERATED_FILE]: record })).toEqual({ actions: [], gaps: [] });

    const agents = serializeGenerated([{ path: 'AGENTS.md', sha256: lfDigest(Buffer.from('Use pnpm.\n')), from: [source('CLAUDE.md', 'Use pnpm.\r\n')] }]);
    expect(await plan({ 'CLAUDE.md': 'Use pnpm.\r\n', 'AGENTS.md': 'Use pnpm.\r\n', [GENERATED_FILE]: agents })).toEqual({ actions: [], gaps: [] });
  });
});

describe('planFill: never', () => {
  it('plans nothing for execution config, which reaches no agent context', async () => {
    expect(await plan({ 'AGENTS.md': 'a', '.claude/settings.json': '{"hooks":{}}' })).toEqual({ actions: [], gaps: [] });
  });

  it('plans nothing with one harness configured', async () => {
    expect(await plan({ 'ctxlock.yaml': 'version: 1\nharnesses: [claude-code]\n', '.agents/skills/release/SKILL.md': SKILL, 'CLAUDE.md': 'Use pnpm.\n' })).toEqual({ actions: [], gaps: [] });
  });
});
