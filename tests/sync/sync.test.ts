import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadRegistry } from '../../src/registry/registry.js';
import { scanRepo } from '../../src/scan.js';
import { type Lock, serializeLock } from '../../src/sync/lock.js';
import { UpstreamError } from '../../src/sync/fetch.js';
import { applySync, EXEC_REASON, planSync } from '../../src/sync/sync.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';
import { cleanup, tempDir } from '../helpers/repo.js';

const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const SKILL = '---\nname: api\ndescription: Use for API work.\n---\nValidate with zod.\n';
const ORG = {
  'ctxlock.yaml': 'version: 1\nunits:\n  .agents/skills/api:\n    tier: certified\n',
  '.agents/skills/api/SKILL.md': SKILL,
  '.agents/skills/api/ref.md': 'Reference.\n',
  '.claude/rules/testing.md': 'Run pnpm test.\n',
  'AGENTS.md': 'The org.\n',
};
const yaml = (units = ['.agents/skills/api', '.claude/rules/testing.md']) =>
  `version: 1\nupstream:\n  platform:\n    repo: ../org\n    units: [${units.join(', ')}]\n`;

async function sync(org: Record<string, string>, commit: string, consumer: Record<string, string | Buffer>, lock: Lock = { upstreams: [] }, links: Record<string, string> = {}) {
  const local = memReader(consumer);
  return planSync(await loadRegistry(local), lock, async () => ({ commit, reader: memReader(org, links) }), local);
}

// The consumer after a plan is written: its files, and the lock.
const after = (consumer: Record<string, string | Buffer>, plan: Awaited<ReturnType<typeof sync>>) => {
  const files: Record<string, string | Buffer> = { ...consumer, 'ctxlock.lock': serializeLock(plan.lock) };
  for (const w of plan.writes) files[w.path] = w.bytes;
  for (const path of plan.removes) delete files[path];
  return files;
};
const unitOf = async (files: Record<string, string>, path: string) => (await scanRepo(memReader(files))).units.find((u) => u.path === path)!;
const failure = (p: Promise<unknown>) => p.then(
  () => {
    throw new Error('expected an UpstreamError');
  },
  (e: unknown) => e as Error,
);

describe('planSync', () => {
  it('adds a declared skill and a rule, at their paths, and pins commit, digests and tiers', async () => {
    const plan = await sync(ORG, C1, { 'ctxlock.yaml': yaml() });

    expect(plan.writes.map((w) => w.path)).toEqual(['.agents/skills/api/SKILL.md', '.agents/skills/api/ref.md', '.claude/rules/testing.md']);
    expect(plan.writes[0]!.bytes.toString('utf8')).toBe(SKILL);
    const reversed = await sync(ORG, C1, { 'ctxlock.yaml': yaml(['.claude/rules/testing.md', '.agents/skills/api']) });
    expect(reversed.writes.map((w) => w.path)).toEqual(plan.writes.map((w) => w.path));
    expect([plan.removes, plan.refused, plan.skipped]).toEqual([[], [], []]);
    const skill = await unitOf(ORG, '.agents/skills/api');
    const rule = await unitOf(ORG, '.claude/rules/testing.md');
    expect(plan.changes).toEqual([
      { upstream: 'platform', path: '.agents/skills/api', change: 'added', to: skill.digest },
      { upstream: 'platform', path: '.claude/rules/testing.md', change: 'added', to: rule.digest },
    ]);
    expect(plan.lock).toEqual({
      upstreams: [
        {
          name: 'platform',
          repo: '../org',
          ref: 'main',
          commit: C1,
          units: [
            {
              path: '.agents/skills/api',
              id: 'skill/.agents/skills/api',
              digest: skill.digest,
              tier: 'certified',
              files: { '.agents/skills/api/SKILL.md': lfDigest(Buffer.from(SKILL)), '.agents/skills/api/ref.md': lfDigest(Buffer.from('Reference.\n')) },
            },
            { path: '.claude/rules/testing.md', id: 'rule/.claude/rules/testing.md', digest: rule.digest, tier: 'reviewed', files: { '.claude/rules/testing.md': lfDigest(Buffer.from('Run pnpm test.\n')) } },
          ],
        },
      ],
    });
  });

  it('a second sync with nothing new upstream changes nothing, the lock included', async () => {
    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const again = await sync(ORG, C1, after(consumer, first), first.lock);

    expect([again.writes, again.removes, again.refused]).toEqual([[], [], []]);
    expect(again.changes.map((c) => c.change)).toEqual(['unchanged', 'unchanged']);
    expect(serializeLock(again.lock)).toBe(serializeLock(first.lock));
  });

  it('an upstream commit that changes none of the units leaves the lock as it was', async () => {
    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const next = await sync({ ...ORG, 'AGENTS.md': 'The org, edited.\n' }, C2, after(consumer, first), first.lock);

    expect(serializeLock(next.lock)).toBe(serializeLock(first.lock));
    expect(next.moved).toEqual([{ upstream: 'platform', ref: 'main', from: C1, to: C1 }]);
    // A tier raised upstream is a change, though no file changed.
    const raised = await sync({ ...ORG, 'ctxlock.yaml': `${ORG['ctxlock.yaml']}  .claude/rules/testing.md:\n    tier: certified\n` }, C2, after(consumer, first), first.lock);
    expect(raised.lock.upstreams[0]!.commit).toBe(C2);
  });

  it('an upstream edit updates the files and the lock, and reports from and to digests', async () => {
    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const edited = { ...ORG, '.claude/rules/testing.md': 'Run pnpm test -- --run.\n' };
    const next = await sync(edited, C2, after(consumer, first), first.lock);

    expect(next.writes.map((w) => w.path)).toEqual(['.claude/rules/testing.md']);
    expect(next.changes[1]).toEqual({
      upstream: 'platform',
      path: '.claude/rules/testing.md',
      change: 'updated',
      from: (await unitOf(ORG, '.claude/rules/testing.md')).digest,
      to: (await unitOf(edited, '.claude/rules/testing.md')).digest,
    });
    expect(next.lock.upstreams[0]!.commit).toBe(C2);
    expect(next.moved).toEqual([{ upstream: 'platform', ref: 'main', from: C1, to: C2 }]);
    expect(first.moved).toEqual([{ upstream: 'platform', ref: 'main', from: null, to: C1 }]);
  });

  it('a unit dropped from units, or a file gone from an upstream skill, removes exactly the locked files', async () => {
    const consumer = { 'ctxlock.yaml': yaml(), 'notes.md': 'mine\n' };
    const first = await sync(ORG, C1, consumer);
    const synced = after(consumer, first);

    const dropped = await sync(ORG, C1, { ...synced, 'ctxlock.yaml': yaml(['.agents/skills/api']) }, first.lock);
    expect(dropped.removes).toEqual(['.claude/rules/testing.md']);
    expect(dropped.changes.find((c) => c.path === '.claude/rules/testing.md')).toMatchObject({ change: 'removed' });
    expect(dropped.lock.upstreams[0]!.units.map((u) => u.path)).toEqual(['.agents/skills/api']);

    const { '.agents/skills/api/ref.md': _, ...smaller } = ORG;
    const shrunk = await sync(smaller, C2, synced, first.lock);
    expect([shrunk.writes, shrunk.removes]).toEqual([[], ['.agents/skills/api/ref.md']]);
  });

  it("refuses to write over a person's file, or a synced file edited by hand", async () => {
    const own = await sync(ORG, C1, { 'ctxlock.yaml': yaml(), '.claude/rules/testing.md': 'Our own rule.\n' });
    expect(own.refused).toEqual([{ path: '.claude/rules/testing.md', reason: 'a file sync did not write' }]);

    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const handEdited = { ...after(consumer, first), '.agents/skills/api/SKILL.md': `${SKILL}One more line.\n` };
    for (const org of [ORG, { ...ORG, '.agents/skills/api/SKILL.md': `${SKILL}Upstream line.\n` }]) {
      expect((await sync(org, C2, handEdited, first.lock)).refused).toEqual([{ path: '.agents/skills/api/SKILL.md', reason: 'edited since the last sync' }]);
    }
  });

  it('an edited file whose unit is taken out of units, or gone from its skill, is left as the person\'s, out of the lock', async () => {
    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const editedRule = { ...after(consumer, first), 'ctxlock.yaml': yaml(['.agents/skills/api']), '.claude/rules/testing.md': 'Changed here.\n' };
    const dropped = await sync(ORG, C1, editedRule, first.lock);

    expect([dropped.refused, dropped.removes, dropped.released]).toEqual([[], [], ['.claude/rules/testing.md']]);
    expect(dropped.lock.upstreams[0]!.units.map((u) => u.path)).toEqual(['.agents/skills/api']);
    // The next sync sees a file it did not write, and leaves it alone.
    const next = await sync(ORG, C1, after(editedRule, dropped), dropped.lock);
    expect([next.writes, next.removes, next.refused, next.released]).toEqual([[], [], [], []]);

    const { '.agents/skills/api/ref.md': _, ...smaller } = ORG;
    const editedRef = { ...after(consumer, first), '.agents/skills/api/ref.md': 'Ours now.\n' };
    expect((await sync(smaller, C2, editedRef, first.lock)).released).toEqual(['.agents/skills/api/ref.md']);
  });

  it('a CRLF copy of an unchanged file is not a change', async () => {
    const consumer = { 'ctxlock.yaml': yaml() };
    const first = await sync(ORG, C1, consumer);
    const crlf = { ...after(consumer, first), '.claude/rules/testing.md': 'Run pnpm test.\r\n' };

    const plan = await sync(ORG, C1, crlf, first.lock);
    expect([plan.writes, plan.removes, plan.refused]).toEqual([[], [], []]);
  });

  it('skips settings.json and hooks inside an upstream skill, and says so', async () => {
    const org = {
      ...ORG,
      '.agents/skills/api/settings.json': '{"hooks":{}}\n',
      '.agents/skills/api/hooks/pre.sh': 'echo hi\n',
      '.agents/skills/api/.mcp.json': '{"mcpServers":{}}\n',
    };
    const plan = await sync(org, C1, { 'ctxlock.yaml': yaml(['.agents/skills/api']) });

    expect(plan.writes.map((w) => w.path)).toEqual(['.agents/skills/api/SKILL.md', '.agents/skills/api/ref.md']);
    expect(plan.skipped).toEqual([
      { path: '.agents/skills/api/.mcp.json', reason: 'MCP servers never sync' },
      { path: '.agents/skills/api/hooks/pre.sh', reason: 'hooks never sync' },
      { path: '.agents/skills/api/settings.json', reason: 'settings never sync' },
    ]);
    expect(Object.keys(plan.lock.upstreams[0]!.units[0]!.files)).toEqual(['.agents/skills/api/SKILL.md', '.agents/skills/api/ref.md']);
  });

  it('never writes a file outside the skill that a link inside it reaches, and says so', async () => {
    const org = { ...ORG, '.claude/settings.json': '{"hooks":{}}\n', 'docs/reference.md': 'Docs.\n' };
    const links = { '.agents/skills/api/cfg.json': '.claude/settings.json', '.agents/skills/api/reference.md': 'docs/reference.md' };
    const plan = await sync({ ...org, '.agents/skills/api/cfg.json': '', '.agents/skills/api/reference.md': '' }, C1, { 'ctxlock.yaml': yaml(['.agents/skills/api']) }, undefined, links);

    expect(plan.writes.map((w) => w.path)).toEqual(['.agents/skills/api/SKILL.md', '.agents/skills/api/ref.md']);
    expect(plan.skipped).toEqual([
      { path: '.claude/settings.json', reason: 'outside .agents/skills/api, reached through a link: never syncs' },
      { path: 'docs/reference.md', reason: 'outside .agents/skills/api, reached through a link: never syncs' },
    ]);
  });

  it('refuses a skill whose frontmatter runs hooks or grants tools, unless allow-exec names it, and says which it took', async () => {
    const hooked = '---\nname: api\ndescription: Use for API work.\nallowed-tools: Bash(git push:*)\n---\nValidate with zod.\n';
    const org = { ...ORG, '.agents/skills/api/SKILL.md': hooked };

    const refused = await sync(org, C1, { 'ctxlock.yaml': yaml() });
    expect(refused.refused).toEqual([{ path: '.agents/skills/api', reason: EXEC_REASON }]);
    expect(refused.allowedExec).toEqual([]);

    const allowed = await sync(org, C1, { 'ctxlock.yaml': `${yaml()}    allow-exec: [.agents/skills/api]\n` });
    expect(allowed.refused).toEqual([]);
    expect(allowed.writes[0]!.bytes.toString('utf8')).toBe(hooked);
    expect(allowed.allowedExec).toEqual(['.agents/skills/api']);
  });

  it('stops on an upstream file name that could reach outside the skill', async () => {
    for (const name of ['..\\..\\settings.json', 'sub/../../../../outside.txt', 'notes.md:stream', `bad${String.fromCodePoint(7)}.md`]) {
      const path = `.agents/skills/api/${name}`;
      const error = await failure(sync({ ...ORG, [path]: 'x\n' }, C1, { 'ctxlock.yaml': yaml(['.agents/skills/api']) }));
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error.message).toBe(`upstream platform: .agents/skills/api holds a file sync will not write: ${JSON.stringify(path)}`);
    }
  });

  it('a declared path that is no unit upstream, or an instructions file, is an UpstreamError naming it', async () => {
    const none = await failure(sync(ORG, C1, { 'ctxlock.yaml': yaml(['.claude/rules/nope.md']) }));
    expect(none).toBeInstanceOf(UpstreamError);
    expect(none.message).toContain('upstream platform: .claude/rules/nope.md is no unit at 1111111');
    const instructions = await failure(sync(ORG, C1, { 'ctxlock.yaml': yaml(['AGENTS.md']) }));
    expect(instructions.message).toContain('upstream platform: AGENTS.md is instructions; only skills and rules sync');
  });
});

describe('applySync', () => {
  afterAll(cleanup);

  it('writes nothing to a path outside the repository, whatever the plan holds', async () => {
    const top = join(tempDir(), 'repo');
    mkdirSync(top);
    for (const path of ['../outside.txt', 'a/../../outside.txt']) {
      const plan = { lock: { upstreams: [] }, moved: [], writes: [{ path, bytes: Buffer.from('x') }], removes: [], changes: [], refused: [], released: [], allowedExec: [], skipped: [] };
      await expect(applySync(top, plan)).rejects.toThrow(`${path} is outside the repository`);
    }
    expect(existsSync(join(top, '..', 'outside.txt'))).toBe(false);
  });
});
