import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { MissSignal, UnitMiss } from '../../src/loop/misses.js';
import { diagnose } from '../../src/loop/propose.js';
import { canSymlink, cleanup, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const FAKE = resolve('tests/helpers/fake-claude.mjs');
const ID = 'rule/.claude/rules/deps.md';
const RULE = '# Dependencies\n\nInstall packages with npm install.\nKeep the lockfile committed.\n';
const probes = (expect: string) => `version: 1\nprobes:\n  - id: deps-dayjs\n    unit: ${ID}\n    prompt: Use dayjs to format a date.\n    expect:\n      command: '${expect}'\n`;

const signal: MissSignal = {
  session: 's1', kind: 'correction', ts: '2026-11-12T10:00:00.000Z', untrusted: false, words: 'no, we use pnpm here',
  task: 'add the dayjs package', actions: [{ tool: 'Bash', target: 'npm install dayjs' }], context: [ID], turn: [ID],
};
const MISS: UnitMiss = {
  id: ID, path: '.claude/rules/deps.md', digest: 'sha256:x', owners: [], upstream: null, sessions: 1, halved: 0, inTurn: 1, loadedIn: 1, everySession: false, olderVersion: 0,
  kinds: { interrupted: 0, correction: 1 }, first: signal.ts, last: signal.ts, routed: false, signals: [signal],
};

const DEFECT = {
  verdict: 'defect',
  reason: 'The rule says npm, and the person uses pnpm.',
  quotes: ['Install packages with npm install.'],
  fix: { find: 'Install packages with npm install.', replace: 'Install packages with pnpm add.' },
  probe: { prompt: 'Add the dayjs package.', expect: { command: 'pnpm add' } },
};

let argvLog: string;
// The diagnosis run answers with the reply; in the replay, a copy whose rule names pnpm gets pnpm.
function scenario(reply: object) {
  const file = join(tempDir(), 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      behaviours: [
        { when: { promptContains: 'You are diagnosing a miss' }, text: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``, calls: [] },
        { when: { file: '.claude/rules/deps.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add dayjs' } }] },
        { calls: [{ tool: 'Bash', input: { command: 'npm install dayjs' } }] },
      ],
    }),
  );
  process.env.FAKE_CLAUDE_SCENARIO = file;
}

beforeEach(() => {
  argvLog = join(tempDir(), 'argv.jsonl');
  process.env.FAKE_CLAUDE_ARGV_LOG = argvLog;
});

function repo(existing = 'dayjs') {
  const root = tempDir();
  writeTree(root, { '.claude/rules/deps.md': RULE, 'evals/probes/deps.yaml': probes(existing) });
  return root;
}

const run = (root: string) => diagnose({ root, miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 2, maxRuns: 16, maxMinutes: 15 });

describe('diagnose', { timeout: 120_000 }, () => {
  it("replays a defect's fix: the miss probe fails as the unit is and passes fixed, so the proposal is validated", async () => {
    scenario(DEFECT);
    const root = repo();

    const p = await run(root);

    expect(p.diagnosis).toMatchObject({ verdict: 'defect', fix: DEFECT.fix });
    expect(p.replay!.status).toBe('validated');
    expect(p.replay!.miss).toMatchObject({ status: 'improved', base: { passed: 0, valid: 2 }, head: { passed: 2, valid: 2 } });
    expect(p.replay!.others.map((o) => [o.probe.id, o.status])).toEqual([['deps-dayjs', 'unchanged']]);
    expect(p.runs).toBe(9);
    expect(p.tier).toBe('reviewed');
    // Nothing in the repository changes, the probe files included.
    expect(readFileSync(join(root, '.claude/rules/deps.md'), 'utf8')).toBe(RULE);
    expect(readFileSync(join(root, 'evals/probes/deps.yaml'), 'utf8')).toBe(probes('dayjs'));
  });

  it('a fix to a rule reached through a linked folder is replayed on the bytes the link copies', async () => {
    scenario(DEFECT);
    const root = tempDir();
    writeTree(root, { 'shared/rules/deps.md': RULE });
    mkdirSync(join(root, '.claude'));
    symlinkSync(join(root, 'shared', 'rules'), join(root, '.claude', 'rules'), 'junction');

    const p = await run(root);

    expect(p.replay!.miss).toMatchObject({ status: 'improved', head: { passed: 2, valid: 2 } });
    expect(p.replay!.status).toBe('validated');
    expect(readFileSync(join(root, 'shared/rules/deps.md'), 'utf8')).toBe(RULE);
  });

  it.runIf(canSymlink)('a fix to a rule that is itself a link is replayed on the bytes the link copies', async () => {
    scenario(DEFECT);
    const root = tempDir();
    writeTree(root, { 'docs/deps.md': RULE, '.claude/rules/keep.md': 'Keep it short.\n' });
    symlinkSync(join('..', '..', 'docs', 'deps.md'), join(root, '.claude', 'rules', 'deps.md'));

    const p = await run(root);

    expect(p.replay!.status).toBe('validated');
    expect(readFileSync(join(root, 'docs/deps.md'), 'utf8')).toBe(RULE);
  });

  it("a fix that changes nothing the agent does, or that makes the unit's other probe worse, is not validated", async () => {
    scenario({ ...DEFECT, fix: { find: 'Keep the lockfile committed.', replace: 'Keep the lockfile in git.' } });
    const unchanged = await run(repo());
    expect(unchanged.replay).toMatchObject({ status: 'not-validated', miss: { status: 'unchanged' } });

    scenario(DEFECT);
    const worse = await run(repo('npm install'));
    expect(worse.replay!.miss.status).toBe('improved');
    expect(worse.replay!.others.map((o) => o.status)).toEqual(['regressed']);
    expect(worse.replay!.status).toBe('not-validated');
  });

  it('a preference verdict runs no replay', async () => {
    scenario({ verdict: 'preference', reason: 'A one-off wish.', quotes: [] });

    const p = await run(repo());

    expect(p).toMatchObject({ diagnosis: { verdict: 'preference', fix: null }, replay: null, runs: 1 });
    expect(readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.includes('"-p"'))).toHaveLength(1);
  });

  it('a replay cut short by the run budget is inconclusive', async () => {
    scenario(DEFECT);

    const p = await diagnose({ root: repo(), miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 2, maxRuns: 4, maxMinutes: 15 });

    expect(p.replay!.status).toBe('inconclusive');
  });

  it("a certified unit's tier is reported", async () => {
    scenario({ verdict: 'agent-error', reason: 'r', quotes: [] });
    const root = repo();
    writeTree(root, { 'ctxlock.yaml': 'version: 1\nunits:\n  .claude/rules/deps.md:\n    tier: certified\n' });

    expect((await run(root)).tier).toBe('certified');
  });
});
