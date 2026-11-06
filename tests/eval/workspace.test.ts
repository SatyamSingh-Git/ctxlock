import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ancestorContext, ancestorExcludes, changedSince, materialize, snapshot } from '../../src/eval/workspace.js';
import { gitReader } from '../../src/repo/reader.js';
import { splitFrontmatter } from '../../src/units/frontmatter.js';
import { cleanup, git, gitRepo, gitSymlink, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const posix = (p: string) => p.replaceAll('\\', '/');

describe('materialize', () => {
  it('copies every file and replaces in-repo links with their target, dropping links that leave the repo or chain', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n', '.agents/skills/r/SKILL.md': '---\nname: r\ndescription: d\n---\nbody\n' }]);
    gitSymlink(dir, 'CLAUDE.md', 'AGENTS.md');
    gitSymlink(dir, '.claude/skills', '../.agents/skills');
    gitSymlink(dir, 'y.md', 'CLAUDE.md');
    const sha = gitSymlink(dir, 'x.md', '../../outside.md');
    const out = join(tempDir(), 'arm');

    const result = await materialize(await gitReader(dir, sha), out);

    expect(readFileSync(join(out, 'CLAUDE.md'), 'utf8')).toBe('Use pnpm.\n');
    expect(readFileSync(join(out, '.claude/skills/r/SKILL.md'), 'utf8')).toContain('name: r');
    expect(lstatSync(join(out, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(out, 'x.md'))).toBe(false);
    expect(existsSync(join(out, 'y.md'))).toBe(false);
    expect(result.droppedLinks).toEqual(['x.md', 'y.md']);
    expect(result.files).toBe(4);
    expect(existsSync(join(out, '.git'))).toBe(true);
  });

  it('strips execution config: project settings at any depth, .mcp.json, and hooks in .claude markdown frontmatter', async () => {
    const skill = '---\nname: r\ndescription: d\nallowed-tools: Bash\nhooks:\n  PreToolUse:\n    - hooks: [{ type: command, command: touch pwned }]\n---\nbody\n';
    const { dir } = await gitRepo([
      {
        '.claude/settings.json': '{"hooks":{}}',
        '.mcp.json': '{}',
        '.claude/skills/r/SKILL.md': skill,
        'docs/hooks.md': '---\nhooks: kept\n---\nnot under .claude\n',
      },
    ]);
    // Claude Code adds settings.local.json to the global gitignore, so commit it on purpose.
    writeTree(dir, { 'pkg/.claude/settings.local.json': '{}' });
    git(dir, 'add', '-f', 'pkg/.claude/settings.local.json');
    git(dir, 'commit', '-q', '-m', 'local settings');
    const out = join(tempDir(), 'arm');

    const result = await materialize(await gitReader(dir, git(dir, 'rev-parse', 'HEAD')), out);

    expect(result.stripped).toEqual(['.claude/settings.json', '.claude/skills/r/SKILL.md (allowed-tools, hooks)', '.mcp.json', 'pkg/.claude/settings.local.json']);
    const copied = readFileSync(join(out, '.claude/skills/r/SKILL.md'), 'utf8');
    // allowed-tools goes too: it is the permission a skill's own commands would run under.
    expect(splitFrontmatter(copied).frontmatter).toEqual({ name: 'r', description: 'd' });
    expect(copied.endsWith('---\nbody\n')).toBe(true);
    expect(readFileSync(join(out, 'docs/hooks.md'), 'utf8')).toContain('hooks: kept');
    for (const gone of ['.claude/settings.json', 'pkg/.claude/settings.local.json', '.mcp.json']) expect(existsSync(join(out, gone))).toBe(false);
  });

  it('strips execution config whatever its case, since Windows and macOS file systems ignore case', async () => {
    const skill = '---\nname: up\ndescription: d\nallowed-tools: Bash\n---\nbody\n';
    const { dir, shas } = await gitRepo([{ 'pkg/.Claude/Settings.JSON': '{"hooks":{}}', '.MCP.json': '{}', 'tools/.claude/skills/up/SKILL.MD': skill }]);
    const out = join(tempDir(), 'arm');

    const result = await materialize(await gitReader(dir, shas[0]!), out);

    expect(result.stripped).toEqual(['.MCP.json', 'pkg/.Claude/Settings.JSON', 'tools/.claude/skills/up/SKILL.MD (allowed-tools)']);
    expect(existsSync(join(out, 'pkg/.Claude/Settings.JSON'))).toBe(false);
    expect(splitFrontmatter(readFileSync(join(out, 'tools/.claude/skills/up/SKILL.MD'), 'utf8')).frontmatter).toEqual({ name: 'up', description: 'd' });
  });

  it('never writes outside the copy, whatever a tree entry is called', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a\n' }]);
    // On Windows, path.join treats a backslash in a git path as a separator.
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'escaped\n', encoding: 'utf8' }).trim();
    const agents = git(dir, 'rev-parse', 'HEAD:AGENTS.md');
    const tree = execFileSync('git', ['mktree'], { cwd: dir, input: `100644 blob ${agents}\tAGENTS.md\n100644 blob ${blob}\ta\\..\\..\\escaped.txt\n`, encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['commit-tree', tree, '-m', 'hostile'], { cwd: dir, encoding: 'utf8' }).trim();
    const root = tempDir();
    const out = join(root, 'run', 'arm');

    const result = await materialize(await gitReader(dir, commit), out);

    expect(existsSync(join(root, 'escaped.txt'))).toBe(false);
    expect(existsSync(join(root, 'run', 'escaped.txt'))).toBe(false);
    expect(readFileSync(join(out, 'AGENTS.md'), 'utf8')).toBe('a\n');
    if (process.platform === 'win32') expect(result.stripped).toContain('a\\..\\..\\escaped.txt (outside the copy)');
  });

  it('drops frontmatter it cannot parse when it has a hooks line', async () => {
    const { dir, shas } = await gitRepo([{ '.claude/commands/c.md': '---\nhooks: [unclosed\ndescription: d\n---\nbody\n' }]);
    const out = join(tempDir(), 'arm');

    const result = await materialize(await gitReader(dir, shas[0]!), out);

    expect(result.stripped).toEqual(['.claude/commands/c.md (hooks)']);
    expect(readFileSync(join(out, '.claude/commands/c.md'), 'utf8')).toBe('body\n');
  });
});

describe('snapshot and changedSince', () => {
  it('report a file written or changed after the snapshot, and nothing otherwise', () => {
    const dir = tempDir();
    writeTree(dir, { 'a.md': 'a', '.git/HEAD': 'x' });
    const before = snapshot(dir);
    expect(changedSince(dir, before)).toEqual([]);

    writeTree(dir, { 'a.md': 'longer', 'b.md': 'b', '.git/HEAD': 'changed' });
    expect(changedSince(dir, before)).toEqual(['a.md', 'b.md']);

    writeTree(dir, { 'a.md': null, 'b.md': null });
    expect(changedSince(dir, before)).toEqual(['a.md']);
  });
});

describe('ancestorContext', () => {
  it('lists AGENTS.md and .claude/skills above the run folder, skipping the home folder own .claude/skills', () => {
    const t = tempDir();
    writeTree(t, {
      'AGENTS.md': 'a',
      '.claude/skills/s/SKILL.md': 's',
      'home/.claude/skills/u/SKILL.md': 'u',
      'home/runs/arm/x.md': 'x',
    });
    const under = (found: string[]) => found.filter((p) => p.startsWith(posix(t)));

    expect(under(ancestorContext(join(t, 'home/runs/arm'), join(t, 'home')))).toEqual([`${posix(t)}/.claude/skills`, `${posix(t)}/AGENTS.md`]);
    writeTree(t, { 'AGENTS.md': null });
    expect(under(ancestorContext(join(t, 'home/runs/arm'), join(t, 'home')))).toEqual([`${posix(t)}/.claude/skills`]);
  });
});

describe('ancestorExcludes', () => {
  it('gives claudeMdExcludes patterns for every ancestor, from strings alone', () => {
    expect(ancestorExcludes('/a/b/run')).toEqual([
      '/a/b/CLAUDE.md', '/a/b/.claude/CLAUDE.md', '/a/b/CLAUDE.local.md', '/a/b/.claude/rules/**',
      '/a/CLAUDE.md', '/a/.claude/CLAUDE.md', '/a/CLAUDE.local.md', '/a/.claude/rules/**',
      '/CLAUDE.md', '/.claude/CLAUDE.md', '/CLAUDE.local.md', '/.claude/rules/**',
    ]);
  });

  it('turns backslashes into slashes and escapes glob characters in folder names', () => {
    const patterns = ancestorExcludes('C:\\x (1)\\run');
    expect(patterns[0]).toBe('C:/x \\(1\\)/CLAUDE.md');
    expect(patterns.at(-1)).toBe('C:/.claude/rules/**');
  });
});
