import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { RepoReader } from '../../src/repo/reader.js';
import { UpstreamError, fetchUpstream } from '../../src/sync/fetch.js';
import { cleanup, git, gitRepo, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const up = (repo: string, ref = 'main') => ({ name: 'platform', repo, ref, units: [] });
const text = async (reader: RepoReader, path: string) => (await reader.readFile(path)).toString('utf8');
const failure = (p: Promise<unknown>) => p.then(
  () => {
    throw new Error('expected an UpstreamError');
  },
  (e: unknown) => e as Error,
);

describe('fetchUpstream', { timeout: 60_000 }, () => {
  it('fetches an upstream into the cache and resolves a branch, a tag and a commit', async () => {
    const { dir, shas } = await gitRepo([{ 'a.md': 'one\n' }, { 'a.md': 'two\n' }]);
    git(dir, 'tag', 'v1', shas[0]!);
    const cache = tempDir();

    const branch = await fetchUpstream(up(dir), cache);
    expect(branch.commit).toBe(shas[1]);
    expect(await text(branch.reader, 'a.md')).toBe('two\n');
    expect((await fetchUpstream(up(dir, 'v1'), cache)).commit).toBe(shas[0]);
    expect((await fetchUpstream(up(dir, shas[0]!), cache)).commit).toBe(shas[0]);
    // A tag made later on a commit the cache already has.
    git(dir, 'tag', 'v0', shas[0]!);
    expect((await fetchUpstream(up(dir, 'v0'), cache)).commit).toBe(shas[0]);
  });

  it('runs no hook and no ext:: transport, whatever git config allows', async () => {
    const work = tempDir();
    const marker = join(work, 'hook-ran').replaceAll('\\', '/');
    const hooks = join(work, 'hooks');
    writeTree(hooks, { 'reference-transaction': `#!/bin/sh\ntouch "${marker}"\n` });
    chmodSync(join(hooks, 'reference-transaction'), 0o755);
    const config = join(work, 'gitconfig');
    writeFileSync(config, `[core]\n\thooksPath = ${hooks.replaceAll('\\', '/')}\n[protocol "ext"]\n\tallow = always\n`);
    // Made before the config applies, so only the fetch could run the hook.
    const { dir } = await gitRepo([{ 'a.md': 'one\n' }]);
    vi.stubEnv('GIT_CONFIG_GLOBAL', config);
    try {
      await fetchUpstream(up(dir), tempDir());
      const ext = join(work, 'ext-ran').replaceAll('\\', '/');
      expect(await failure(fetchUpstream(up(`ext::sh -c touch% ${ext}`), tempDir()))).toBeInstanceOf(UpstreamError);
      expect([existsSync(marker), existsSync(ext)]).toEqual([false, false]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a second fetch sees a commit made since', async () => {
    const { dir } = await gitRepo([{ 'a.md': 'one\n' }]);
    const cache = tempDir();
    await fetchUpstream(up(dir), cache);
    writeTree(dir, { 'a.md': 'three\n' });
    git(dir, 'commit', '-q', '-am', 'later');

    const later = await fetchUpstream(up(dir), cache);
    expect(later.commit).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(await text(later.reader, 'a.md')).toBe('three\n');
  });

  it('the reader gives the files at the resolved commit, not the upstream working tree', async () => {
    const { dir } = await gitRepo([{ 'a.md': 'committed\n' }]);
    writeTree(dir, { 'a.md': 'not committed\n', 'b.md': 'new\n' });

    const { reader } = await fetchUpstream(up(dir), tempDir());
    expect(await text(reader, 'a.md')).toBe('committed\n');
    expect(await reader.exists('b.md')).toBe(false);
  });

  it('a ref or a repository that does not exist is an UpstreamError naming the upstream', async () => {
    const { dir } = await gitRepo([{ 'a.md': 'one\n' }]);

    const ref = await failure(fetchUpstream(up(dir, 'nope'), tempDir()));
    expect(ref).toBeInstanceOf(UpstreamError);
    expect(ref.message).toContain('upstream platform');
    expect(ref.message).toContain('nope');
    const repo = await failure(fetchUpstream(up(join(tempDir(), 'missing')), tempDir()));
    expect(repo).toBeInstanceOf(UpstreamError);
    expect(repo.message).toContain('upstream platform');
  });

  it('a repository that starts with a dash is not read as an option', async () => {
    const work = tempDir();
    const planted = join(work, 'planted');
    const err = await failure(fetchUpstream(up(`--upload-pack=git init ${planted}`), tempDir()));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(existsSync(planted)).toBe(false);
  });
});
