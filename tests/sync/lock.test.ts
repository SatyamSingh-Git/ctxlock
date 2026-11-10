import { describe, expect, it } from 'vitest';
import { type Lock, LockError, loadLock, serializeLock } from '../../src/sync/lock.js';
import { memReader } from '../helpers/mem-reader.js';

const COMMIT = 'a'.repeat(40);
const lock: Lock = {
  upstreams: [
    {
      name: 'platform',
      repo: 'https://example.com/acme/context.git',
      ref: 'main',
      commit: COMMIT,
      units: [
        { path: '.claude/rules/b.md', id: 'rule/.claude/rules/b.md', digest: 'sha256:2', tier: 'reviewed', files: { '.claude/rules/b.md': 'f2' } },
        {
          path: '.agents/skills/api',
          id: 'skill/.agents/skills/api',
          digest: 'sha256:1',
          tier: 'certified',
          files: { '.agents/skills/api/z.md': 'f3', '.agents/skills/api/SKILL.md': 'f1' },
        },
      ],
    },
    { name: 'base', repo: '../org', ref: 'v1', commit: 'b'.repeat(40), units: [] },
  ],
};

const errorOf = (text: string) => loadLock(memReader({ 'ctxlock.lock': text })).then(
  () => {
    throw new Error('expected a LockError');
  },
  (e: unknown) => e as Error,
);

describe('ctxlock.lock', () => {
  it('serializeLock is stable whatever the order it is given, and loadLock reads it back', async () => {
    const text = serializeLock(lock);
    const shuffled: Lock = {
      upstreams: [...lock.upstreams].reverse().map((u) => ({ ...u, units: [...u.units].reverse() })),
    };

    expect(serializeLock(shuffled)).toBe(text);
    expect(text.startsWith('lockfile_version: 1\n')).toBe(true);
    const read = await loadLock(memReader({ 'ctxlock.lock': text }));
    expect(read.upstreams.map((u) => u.name)).toEqual(['base', 'platform']);
    expect(read.upstreams[1]!.units.map((u) => u.path)).toEqual(['.agents/skills/api', '.claude/rules/b.md']);
    expect(Object.keys(read.upstreams[1]!.units[0]!.files)).toEqual(['.agents/skills/api/SKILL.md', '.agents/skills/api/z.md']);
    expect(serializeLock(read)).toBe(text);
  });

  it('an absent lock is empty; another version, a short commit or broken YAML is a LockError naming the file', async () => {
    expect(await loadLock(memReader({}))).toEqual({ upstreams: [] });
    for (const text of [serializeLock(lock).replace('lockfile_version: 1', 'lockfile_version: 2'), serializeLock(lock).replace(COMMIT, 'abc1234'), 'upstreams: [unclosed']) {
      const err = await errorOf(text);
      expect(err).toBeInstanceOf(LockError);
      expect(err.message).toContain('ctxlock.lock');
    }
  });
});
