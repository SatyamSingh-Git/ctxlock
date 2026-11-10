import { describe, expect, it } from 'vitest';
import { lockDrift } from '../../src/lint/rules/l16-lock.js';
import { serializeLock } from '../../src/sync/lock.js';
import { lfDigest } from '../../src/units/digest.js';
import { lintContext } from '../helpers/lint.js';

const C1 = 'abcdef1'.padEnd(40, '0');
const RULE = 'Run pnpm test.\n';
const SKILL = '---\nname: api\ndescription: Use for API work.\n---\nValidate with zod.\n';
const LOCK = serializeLock({
  upstreams: [
    {
      name: 'platform',
      repo: '../org',
      ref: 'main',
      commit: C1,
      units: [
        { path: '.agents/skills/api', id: 'skill/.agents/skills/api', digest: `sha256:${'a'.repeat(64)}`, tier: 'certified', files: { '.agents/skills/api/SKILL.md': lfDigest(Buffer.from(SKILL)) } },
        { path: '.claude/rules/testing.md', id: 'rule/.claude/rules/testing.md', digest: `sha256:${'b'.repeat(64)}`, tier: 'reviewed', files: { '.claude/rules/testing.md': lfDigest(Buffer.from(RULE)) } },
      ],
    },
  ],
});
const YAML = 'version: 1\nupstream:\n  platform:\n    repo: ../org\n    units: [.agents/skills/api, .claude/rules/testing.md]\n';
const SYNCED = { 'ctxlock.yaml': YAML, 'ctxlock.lock': LOCK, '.agents/skills/api/SKILL.md': SKILL, '.claude/rules/testing.md': RULE };

const run = async (files: Record<string, string>) => (await lockDrift.check(await lintContext(files))).map((f) => [f.severity, f.path, f.message]);

describe('L16-lock', () => {
  it('finds nothing in a clean sync, a CRLF copy included, or with no lock', async () => {
    expect(await run(SYNCED)).toEqual([]);
    expect(await run({ ...SYNCED, '.claude/rules/testing.md': RULE.replace('\n', '\r\n') })).toEqual([]);
    expect(await run({ 'AGENTS.md': 'a\n' })).toEqual([]);
  });

  it('a synced file edited by hand, or missing, is a must naming its upstream and commit', async () => {
    const { '.agents/skills/api/SKILL.md': _, ...noSkill } = SYNCED;
    expect(await run({ ...noSkill, '.claude/rules/testing.md': 'Run npm test.\n' })).toEqual([
      ['must', '.agents/skills/api/SKILL.md', '.agents/skills/api/SKILL.md is missing; ctxlock.lock has it synced from platform at abcdef1; run ctxlock sync, or remove it from upstream units'],
      [
        'must',
        '.claude/rules/testing.md',
        '.claude/rules/testing.md differs from ctxlock.lock (synced from platform at abcdef1); change it upstream, or remove it from upstream units',
      ],
    ]);
  });

  it('an upstream or unit ctxlock.yaml no longer declares is a should', async () => {
    const one = 'version: 1\nupstream:\n  platform:\n    repo: ../org\n    units: [.agents/skills/api]\n';
    expect(await run({ ...SYNCED, 'ctxlock.yaml': one })).toEqual([
      ['should', 'ctxlock.lock', 'ctxlock.lock pins .claude/rules/testing.md from platform, which ctxlock.yaml no longer lists; run ctxlock sync'],
    ]);
    expect(await run({ ...SYNCED, 'ctxlock.yaml': 'version: 1\n' })).toEqual([
      ['should', 'ctxlock.lock', 'ctxlock.lock pins upstream platform, which ctxlock.yaml no longer declares; run ctxlock sync'],
    ]);
  });

  it('a lock that does not parse is a must, with the reason', async () => {
    const findings = await run({ ...SYNCED, 'ctxlock.lock': 'lockfile_version: 2\n' });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slice(0, 2)).toEqual(['must', 'ctxlock.lock']);
    expect(findings[0]![2]).toMatch(/^ctxlock\.lock: lockfile_version: /);
  });
});
