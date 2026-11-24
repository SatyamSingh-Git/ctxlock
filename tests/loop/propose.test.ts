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
  kinds: { interrupted: 0, correction: 1, abandoned: 0 }, first: signal.ts, last: signal.ts, routed: false, signals: [signal],
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

const run = (root: string) => diagnose({ root, miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 16, maxMinutes: 15 });

describe('diagnose', { timeout: 120_000 }, () => {
  it("replays a defect's fix: the miss probe fails as the unit is and passes fixed, so the proposal is validated", async () => {
    scenario(DEFECT);
    const root = repo();

    const p = await run(root);

    expect(p.diagnosis).toMatchObject({ verdict: 'defect', fix: DEFECT.fix });
    expect(p.replay!.status).toBe('validated');
    expect(p.replay!.miss).toMatchObject({ status: 'improved', base: { passed: 0, valid: 3 }, head: { passed: 3, valid: 3 } });
    expect(p.replay!.others.map((o) => [o.probe.id, o.status])).toEqual([['deps-dayjs', 'unchanged']]);
    // 1 diagnosis and 12 replay runs: two probes, two arms, 3 runs each (D120).
    expect(p.runs).toBe(13);
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

    expect(p.replay!.miss).toMatchObject({ status: 'improved', head: { passed: 3, valid: 3 } });
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

  it('diagnose --ablate replays the miss probe without the unit: a rule that causes the miss is improved by its removal', async () => {
    // The agent follows the rule's npm; without the rule it reads package.json and uses pnpm.
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        behaviours: [
          { when: { promptContains: 'You are diagnosing a miss' }, text: `\`\`\`json\n${JSON.stringify(DEFECT)}\n\`\`\``, calls: [] },
          { when: { file: '.claude/rules/deps.md', contains: 'npm install' }, calls: [{ tool: 'Bash', input: { command: 'npm install dayjs' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'pnpm add dayjs' } }] },
        ],
      }),
    );
    process.env.FAKE_CLAUDE_SCENARIO = file;
    const root = repo();

    const p = await diagnose({ root, miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 16, maxMinutes: 15, ablate: true });

    expect(p.replay!.status).toBe('validated');
    expect(p.replay!.ablation).toMatchObject({ status: 'improved', base: { passed: 0, valid: 3 }, head: { passed: 3, valid: 3 } });
    // 1 diagnosis, 12 replay runs, 3 ablation runs: the base side is the replay's, not run again.
    expect(p.runs).toBe(16);
    expect(p.replay!.ablation).toMatchObject({ base: p.replay!.miss.base });
    expect(readFileSync(join(root, '.claude/rules/deps.md'), 'utf8')).toBe(RULE);
    // Without --ablate, nothing extra runs.
    expect((await run(repo())).replay!.ablation).toBeUndefined();

    // --max-runs covers the ablation too: 14 leaves 2 after the replay's 12, too few for a side of 3.
    const short = await diagnose({ root: repo(), miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 14, maxMinutes: 15, ablate: true });
    expect(short.replay!.ablation).toEqual({ skipped: 'the replay left too few of the 14 runs --max-runs allows' });
    expect(short.runs).toBe(13);
    const enough = await diagnose({ root: repo(), miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 15, maxMinutes: 15, ablate: true });
    expect(enough.replay!.ablation).toMatchObject({ status: 'improved' });
  });

  it('ablation is skipped, and says why, for a unit reached through a link', async () => {
    scenario(DEFECT);
    const root = tempDir();
    writeTree(root, { 'shared/rules/deps.md': RULE });
    mkdirSync(join(root, '.claude'));
    symlinkSync(join(root, 'shared', 'rules'), join(root, '.claude', 'rules'), 'junction');

    const p = await diagnose({ root, miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 16, maxMinutes: 15, ablate: true });

    expect(p.replay!.ablation).toEqual({ skipped: 'the unit is reached through a link, and taking out the link would take out what else it holds' });
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

  it("a fix that may make the unit's other probe worse, 3/3 to 1/3, is inconclusive, not validated", async () => {
    // Runs 2 to 7 are the miss's, 8 to 13 the other probe's, base first: run 9 is its first head run.
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        counterFile: join(tempDir(), 'count'),
        behaviours: [
          { when: { promptContains: 'You are diagnosing a miss' }, text: `\`\`\`json\n${JSON.stringify(DEFECT)}\n\`\`\``, calls: [] },
          { when: { runs: [9] }, calls: [{ tool: 'Bash', input: { command: 'npm install dayjs' } }] },
          { when: { file: '.claude/rules/deps.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add dayjs' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'npm install dayjs' } }] },
        ],
      }),
    );
    process.env.FAKE_CLAUDE_SCENARIO = file;

    const p = await run(repo('npm install'));

    expect(p.replay!.miss.status).toBe('improved');
    expect(p.replay!.others).toMatchObject([{ status: 'uncertain', base: { passed: 3 }, head: { passed: 1 } }]);
    expect(p.replay!.status).toBe('inconclusive');
  });

  it('a preference verdict runs no replay', async () => {
    scenario({ verdict: 'preference', reason: 'A one-off wish.', quotes: [] });

    const p = await run(repo());

    expect(p).toMatchObject({ diagnosis: { verdict: 'preference', fix: null }, replay: null, runs: 1 });
    expect(readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.includes('"-p"'))).toHaveLength(1);
  });

  it('a fix that only looks better, 1/3 against 3/3, leaves the replay inconclusive', async () => {
    // Run 2 uses pnpm whatever the rule says. The diagnosis is run 1, and the arms take turns, so run 2 is the miss's first base run.
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        counterFile: join(tempDir(), 'count'),
        behaviours: [
          { when: { promptContains: 'You are diagnosing a miss' }, text: `\`\`\`json\n${JSON.stringify(DEFECT)}\n\`\`\``, calls: [] },
          { when: { file: '.claude/rules/deps.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add dayjs' } }] },
          { when: { runs: [2] }, calls: [{ tool: 'Bash', input: { command: 'pnpm add dayjs' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'npm install dayjs' } }] },
        ],
      }),
    );
    process.env.FAKE_CLAUDE_SCENARIO = file;

    const p = await run(repo());

    expect(p.replay!.miss).toMatchObject({ status: 'uncertain', base: { passed: 1, valid: 3 }, head: { passed: 3, valid: 3 } });
    expect(p.replay!.status).toBe('inconclusive');

    // With --extend the miss runs on to 10 a side: 1/10 against 10/10 shows the fix works.
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), counterFile: join(tempDir(), 'count') }));
    const extended = await diagnose({ root: repo(), miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 40, maxMinutes: 15, extendTo: 10 });
    expect(extended.replay!.miss).toMatchObject({ status: 'improved', base: { passed: 1, valid: 10 }, head: { passed: 10, valid: 10 } });
    expect(extended.replay!.status).toBe('validated');
  });

  it('a replay cut short by the run budget is inconclusive', async () => {
    scenario(DEFECT);

    const p = await diagnose({ root: repo(), miss: MISS, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), runs: 3, maxRuns: 4, maxMinutes: 15 });

    expect(p.replay!.status).toBe('inconclusive');
  });

  it("a certified unit's tier is reported", async () => {
    scenario({ verdict: 'agent-error', reason: 'r', quotes: [] });
    const root = repo();
    writeTree(root, { 'ctxlock.yaml': 'version: 1\nunits:\n  .claude/rules/deps.md:\n    tier: certified\n' });

    expect((await run(root)).tier).toBe('certified');
  });
});
