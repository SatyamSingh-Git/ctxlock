import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FileNotFound, RefNotFound, fsReader, gitReader } from '../../src/repo/reader.js';
import { canSymlink, cleanup, git, gitRepo, gitSymlink, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

describe('fsReader', () => {
  it('lists tracked and untracked-unignored files, POSIX-sorted, without .git or node_modules', async () => {
    const { dir } = await gitRepo([{ '.gitignore': 'ignored.txt\n', 'b.md': 'b', 'a/AGENTS.md': 'a', 'gone.md': 'x' }]);
    writeTree(dir, { 'c.md': 'c', 'ignored.txt': 'i', 'node_modules/pkg/AGENTS.md': 'n', 'gone.md': null });

    expect(await fsReader(dir).listFiles()).toEqual(['.gitignore', 'a/AGENTS.md', 'b.md', 'c.md']);
  });

  it('includes CLAUDE.local.md even when .gitignore excludes it', async () => {
    const { dir } = await gitRepo([{ '.gitignore': 'CLAUDE.local.md\n', 'CLAUDE.md': 'shared' }]);
    writeTree(dir, { 'CLAUDE.local.md': 'mine', 'sub/CLAUDE.local.md': 'mine too' });

    expect(await fsReader(dir).listFiles()).toEqual([
      '.gitignore',
      'CLAUDE.local.md',
      'CLAUDE.md',
      'sub/CLAUDE.local.md',
    ]);
  });

  it('includes the root .claude/settings.local.json even when .gitignore excludes it', async () => {
    const { dir } = await gitRepo([{ '.gitignore': 'settings.local.json\n', 'AGENTS.md': 'a' }]);
    writeTree(dir, { '.claude/settings.local.json': '{}', 'sub/.claude/settings.local.json': '{}' });

    expect(await fsReader(dir).listFiles()).toEqual(['.claude/settings.local.json', '.gitignore', 'AGENTS.md']);
  });

  it('works in a directory that is not a git repo', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', 'x/y.md': 'y', 'node_modules/p/AGENTS.md': 'n', '.git/config': 'not a repo' });

    expect(await fsReader(dir).listFiles()).toEqual(['AGENTS.md', 'x/y.md']);
  });

  it('readFile on a missing path throws FileNotFound', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a' }]);

    await expect(fsReader(dir).readFile('missing.md')).rejects.toBeInstanceOf(FileNotFound);
  });

  it.runIf(canSymlink)('never reads through a symlink that leaves the repo, in git or not', async () => {
    const outside = tempDir();
    writeTree(outside, { 'secret.yaml': 'key: secret\n' });
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', 'x/y.md': 'y' }]);
    const plain = tempDir();
    writeTree(plain, { 'AGENTS.md': 'a', 'x/y.md': 'y' });

    for (const root of [dir, plain]) {
      symlinkSync(join(outside, 'secret.yaml'), join(root, 'ctxlock.yaml'));
      const reader = fsReader(root);

      await expect(reader.readFile('ctxlock.yaml')).rejects.toBeInstanceOf(FileNotFound);
      expect(await reader.exists('ctxlock.yaml')).toBe(false);
      expect([await reader.exists('AGENTS.md'), await reader.exists('x')]).toEqual([true, true]);
      expect(await reader.listSymlinks()).toEqual(new Map([['ctxlock.yaml', null]]));
    }
  });

  it.runIf(canSymlink)('maps an untracked in-repo symlink to its target and leaves it out of listFiles', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a' }]);
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    const reader = fsReader(dir);

    expect(await reader.listSymlinks()).toEqual(new Map([['CLAUDE.md', 'AGENTS.md']]));
    expect(await reader.listFiles()).toEqual(['AGENTS.md']);
  });

  it('skips files a sparse checkout left out of the working tree', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', 'pkg/AGENTS.md': 'p', 'other/CLAUDE.md': 'o' }]);
    git(dir, 'sparse-checkout', 'set', '--no-cone', '/AGENTS.md', '/pkg/');

    expect(await fsReader(dir).listFiles()).toEqual(['AGENTS.md', 'pkg/AGENTS.md']);
  });

  it('skips an untracked nested git repository', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a' }]);
    writeTree(dir, { 'vendor/x/AGENTS.md': 'v' });
    git(join(dir, 'vendor/x'), 'init', '-q');

    expect(await fsReader(dir).listFiles()).toEqual(['AGENTS.md']);
  });
});

describe('a reader opened on a subdirectory', () => {
  it('lists and reads paths relative to the repository top level, for the working tree and a ref alike', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'root', 'pkg/AGENTS.md': 'pkg' }]);
    const tree = fsReader(join(dir, 'pkg'));
    const head = await gitReader(join(dir, 'pkg'), 'HEAD');

    expect(await tree.listFiles()).toEqual(['AGENTS.md', 'pkg/AGENTS.md']);
    expect(await head.listFiles()).toEqual(['AGENTS.md', 'pkg/AGENTS.md']);
    expect((await tree.readFile('AGENTS.md')).toString()).toBe('root');
    expect((await head.readFile('AGENTS.md')).toString()).toBe('root');
  });
});

describe('gitReader', () => {
  it('returns content as of the ref', async () => {
    const { dir, shas } = await gitRepo([{ 'AGENTS.md': 'a' }, { 'AGENTS.md': 'b' }]);

    expect((await (await gitReader(dir, shas[0]!)).readFile('AGENTS.md')).toString()).toBe('a');
    expect((await (await gitReader(dir, shas[1]!)).readFile('AGENTS.md')).toString()).toBe('b');
  });

  it('rejects an unknown ref with RefNotFound', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a' }]);

    const err = await gitReader(dir, 'no-such-ref').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefNotFound);
    expect((err as RefNotFound).ref).toBe('no-such-ref');
  });

  it('readFile on a missing path throws FileNotFound', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a' }]);

    const err = await (await gitReader(dir, 'HEAD')).readFile('missing.md').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileNotFound);
    expect((err as FileNotFound).path).toBe('missing.md');
  });

  it('listSymlinks maps in-repo targets and returns null for ../../outside', async () => {
    const { dir } = await gitRepo([{ '.agents/skills/x/SKILL.md': '---\nname: x\n---\n' }]);
    gitSymlink(dir, '.claude/skills/x', '../../.agents/skills/x');
    gitSymlink(dir, 'evil', '../../outside');
    const reader = await gitReader(dir, 'HEAD');

    expect(await reader.listSymlinks()).toEqual(
      new Map([
        ['.claude/skills/x', '.agents/skills/x'],
        ['evil', null],
      ]),
    );
    expect(await reader.listFiles()).toEqual(['.agents/skills/x/SKILL.md']);
  });
});

describe('readAll', () => {
  it('yields every listed file byte for byte, CRLF and binary included, from a ref and the working tree', async () => {
    const bin = Buffer.from([0, 255, 13, 10, 0]);
    const { dir, shas } = await gitRepo([{ 'a.md': 'x\r\ny\r\n', 'b.bin': bin, 'c/d.md': 'd' }]);
    for (const reader of [await gitReader(dir, shas[0]!), fsReader(dir)]) {
      const seen = new Map<string, Buffer>();
      await reader.readAll((path, bytes) => void seen.set(path, bytes));
      expect([...seen.keys()]).toEqual(await reader.listFiles());
      expect(seen.get('a.md')!.toString('utf8')).toBe('x\r\ny\r\n');
      expect(seen.get('b.bin')!.equals(bin)).toBe(true);
      expect(seen.get('c/d.md')!.toString('utf8')).toBe('d');
    }
  });

  it('stops git when the callback throws, so a failed copy cannot leave ctxlock waiting on it', async () => {
    // More than a pipe holds, so git blocks writing if nobody reads the rest.
    const big = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}.md`, 'x'.repeat(100_000)]));
    const { dir, shas } = await gitRepo([big]);
    const processes = () => process.getActiveResourcesInfo().filter((r) => r === 'ProcessWrap').length;
    const before = processes();

    await expect((await gitReader(dir, shas[0]!)).readAll(() => { throw new Error('disk full'); })).rejects.toThrow('disk full');
    await new Promise((r) => setTimeout(r, 100));

    expect(processes()).toBe(before);
  });
});
