import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type ArmResult, EvalError, type EvalOptions, runEval, runProbes, status } from '../../src/eval/eval.js';
import { parseProbeFile } from '../../src/eval/probes.js';
import { overlayReader } from '../../src/repo/overlay.js';
import { fsReader } from '../../src/repo/reader.js';
import { scanRepo } from '../../src/scan.js';
import { cleanup, git, gitRepo, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const FAKE = resolve('tests/helpers/fake-claude.mjs');
const PNPM = '\\bpnpm\\s+add\\b';

const probeFile = (...probes: Array<{ id: string; pattern?: string; unit?: string; prompt?: string }>) =>
  `version: 1\nprobes:\n${probes
    .map((p) => `  - id: ${p.id}\n    unit: ${p.unit ?? 'instructions/AGENTS.md'}\n    prompt: ${p.prompt ?? 'Add zod as a dependency.'}\n    expect:\n      command: '${p.pattern ?? PNPM}'\n`)
    .join('')}`;

let argvLog: string;

beforeEach(() => {
  argvLog = join(tempDir(), 'argv.jsonl');
  process.env.FAKE_CLAUDE_ARGV_LOG = argvLog;
  scenario({});
});

function scenario(extra: Record<string, unknown>) {
  const file = join(tempDir(), 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      behaviours: [
        { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] },
        { calls: [{ tool: 'Bash', input: { command: 'npm install zod' } }] },
      ],
      ...extra,
    }),
  );
  process.env.FAKE_CLAUDE_SCENARIO = file;
}

const claudeRuns = () => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.includes('"-p"')).length : 0);

async function repo(base: Record<string, string>, work: Record<string, string | null> = {}) {
  const { dir } = await gitRepo([base]);
  writeTree(dir, work);
  return dir;
}

const options = (root: string, extra: Partial<EvalOptions> = {}): EvalOptions => ({
  root, base: 'HEAD', runs: 3, maxRuns: 24, maxMinutes: 20, model: 'sonnet', claude: [FAKE], ctxlockVersion: '0.1.0',
  workdir: join(tempDir(), 'work'), cacheDir: null, all: false, keepRuns: false, ...extra,
});

const round = (i: [number, number] | null) => i?.map((x) => Math.round(x * 1e4) / 1e4);

describe('runEval', { timeout: 120_000 }, () => {
  it('a changed instruction flips its adherence probe: base 0/3, head 3/3, improved', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });

    const r = await runEval(options(root));

    expect(r.changedUnits).toEqual(['instructions/AGENTS.md']);
    expect(r.outcomes).toHaveLength(1);
    const [o] = r.outcomes;
    expect(o).toMatchObject({ status: 'improved', source: 'base', changedInHead: false, base: { passed: 0, valid: 3, cached: 0 }, head: { passed: 3, valid: 3 } });
    expect(o!.base!.models).toEqual(['claude-sonnet-5-5']);
    expect(round(o!.base!.interval)).toEqual([0, 0.5615]);
    expect(round(o!.head!.interval)).toEqual([0.4385, 1]);
    expect(r.totals.runs).toBe(6);
    expect(claudeRuns()).toBe(6);
    expect(r.claudeVersion).toBe('2.1.292');
  });

  it('runs the probes of what depends on the change and of the consumers it reaches, says why each ran, and runs the changed first', async () => {
    const yaml =
      'version: 1\nunits:\n  AGENTS.md:\n    depends-on: [.claude/rules/x.md]\nconsumers:\n  payments-api:\n    depends-on: [.claude/rules/x.md]\n    evals: [evals/probes/payments.yaml]\n  web:\n    depends-on: [.claude/rules/z.md]\n    evals: [evals/probes/other.yaml]\n';
    const root = await repo(
      {
        'AGENTS.md': 'Use pnpm.\n',
        '.claude/rules/x.md': 'Use tabs.\n',
        '.claude/rules/y.md': 'Use semicolons.\n',
        '.claude/rules/z.md': 'Use single quotes.\n',
        'ctxlock.yaml': yaml,
        'evals/probes/agents.yaml': probeFile({ id: 'deps' }),
        'evals/probes/other.yaml': probeFile({ id: 'other', unit: 'rule/.claude/rules/z.md' }),
        'evals/probes/payments.yaml': probeFile({ id: 'payments', unit: 'rule/.claude/rules/y.md' }),
        'evals/probes/x.yaml': probeFile({ id: 'tabs', unit: 'rule/.claude/rules/x.md' }),
      },
      { '.claude/rules/x.md': 'Use spaces.\n' },
    );

    const r = await runEval(options(root));

    expect(r.changedUnits).toEqual(['rule/.claude/rules/x.md']);
    expect(r.outcomes.map((o) => [o.probe.id, o.selectedFor])).toEqual([
      ['tabs', 'changed'],
      ['deps', 'depends on .claude/rules/x.md'],
      ['payments', 'consumer payments-api'],
    ]);
  });

  it("runs the base's probes before the ones a pull request adds, so those cannot push the base's out of the run budget", async () => {
    const added = probeFile(...['a', 'b', 'c', 'd'].map((id) => ({ id: `new-${id}`, unit: 'rule/.claude/rules/x.md' })));
    const root = await repo(
      { 'AGENTS.md': 'Use pnpm.\n', '.claude/rules/x.md': 'Use tabs.\n', 'ctxlock.yaml': 'version: 1\nunits:\n  AGENTS.md:\n    depends-on: [.claude/rules/x.md]\n', 'evals/probes/agents.yaml': probeFile({ id: 'deps' }) },
      { '.claude/rules/x.md': 'Use spaces.\n', 'evals/probes/new.yaml': added },
    );

    const r = await runEval(options(root));

    expect(r.outcomes.map((o) => [o.probe.id, o.source, o.status === 'not-run'])).toEqual([
      ['deps', 'base', false],
      ['new-a', 'head', false],
      ['new-b', 'head', false],
      ['new-c', 'head', false],
      ['new-d', 'head', true],
    ]);
  });

  it('reverting the change clears the flag: nothing runs, and with all every probe is unchanged', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) });

    const quiet = await runEval(options(root));
    expect(quiet.outcomes).toEqual([]);
    expect(claudeRuns()).toBe(0);

    const all = await runEval(options(root, { all: true }));
    expect(all.outcomes[0]).toMatchObject({ status: 'unchanged', base: { passed: 0 }, head: { passed: 0 }, selectedFor: 'all' });
  });

  it('the gate fails only a base probe whose every base run passed and no head run did', async () => {
    const regressed = await runEval(options(await repo({ 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use npm.\n' })));
    expect(regressed.outcomes[0]!.status).toBe('regressed');
    expect(regressed.gateFailures).toEqual(['deps']);

    const headOnly = await runEval(
      options(await repo({ 'AGENTS.md': 'Use pnpm.\n' }, { 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) })),
    );
    expect(headOnly.outcomes[0]).toMatchObject({ status: 'regressed', source: 'head' });
    expect(headOnly.gateFailures).toEqual([]);
  });

  it("keeps the base definition of a probe the head rewrites, so a pull request cannot rewrite its own judge", async () => {
    const root = await repo(
      { 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) },
      { 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps', pattern: '\\bnpm\\s+install\\b' }) },
    );

    const [o] = (await runEval(options(root))).outcomes;

    expect(o).toMatchObject({ status: 'regressed', changedInHead: true, probe: { expect: { command: PNPM } } });
  });

  it('probes past the run budget are not run, and say why', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'a' }, { id: 'b' }) }, { 'AGENTS.md': 'Use pnpm.\n' });

    const r = await runEval(options(root, { maxRuns: 6 }));

    expect(r.outcomes.map((o) => [o.probe.id, o.status, o.reason])).toEqual([
      ['a', 'improved', undefined],
      ['b', 'not-run', 'run budget (6 runs)'],
    ]);
    expect(r.totals.runs).toBe(6);
  });

  it('stops starting runs once the time budget has passed', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'a' }, { id: 'b' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    let t = 0;

    const r = await runEval(options(root, { maxMinutes: 20, now: () => (t += 11 * 60_000) }));

    expect(r.outcomes.map((o) => [o.probe.id, o.status, o.reason])).toEqual([
      ['a', 'inconclusive', 'time budget (20 min)'],
      ['b', 'not-run', 'time budget (20 min)'],
    ]);
    expect(r.totals.runs).toBe(1);
  });

  it('never gates a probe the time budget cut short, though it reached 3 runs an arm', async () => {
    const root = await repo({ 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use npm.\n' });
    // The first call is the start; the last run's check finds the budget gone, so the base arm is
    // complete and the head arm one short.
    let calls = 0;

    const r = await runEval(options(root, { runs: 4, now: () => (++calls >= 9 ? 21 * 60_000 : 0) }));

    expect(r.outcomes[0]).toMatchObject({ status: 'inconclusive', reason: 'time budget (20 min)', base: { valid: 4, passed: 4 }, head: { valid: 3, passed: 0 } });
    expect(r.gateFailures).toEqual([]);
  });

  it('still reports a fully cached probe that comes after the time budget ran out', async () => {
    const { dir: root } = await gitRepo([{ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'a', prompt: 'Add lodash.' }, { id: 'b' }) }]);
    writeTree(root, { 'AGENTS.md': 'Use pnpm.\n' });
    git(root, 'commit', '-qam', 'pnpm');
    const cacheDir = join(tempDir(), 'cache');
    const refs = { base: 'HEAD~1', head: 'HEAD', all: true, cacheDir };
    // a's runs fail, so only b is cached.
    scenario({ behaviours: [{ when: { promptContains: 'lodash' }, exit: 1, stderr: 'boom' }, { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] }, { calls: [] }] });
    await runEval(options(root, refs));

    scenario({});
    const r = await runEval(options(root, { ...refs, now: (() => { let calls = 0; return () => (++calls > 1 ? 21 * 60_000 : 0); })() }));

    expect(r.outcomes.map((o) => [o.probe.id, o.status, o.reason])).toEqual([
      ['a', 'not-run', 'time budget (20 min)'],
      ['b', 'improved', undefined],
    ]);
    expect(r.outcomes[1]).toMatchObject({ base: { cached: 3 }, head: { cached: 3 } });
    expect(r.totals.runs).toBe(0);
  });

  it('caches base runs by git tree, probe, model and Claude Code version', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    const cacheDir = join(tempDir(), 'cache');

    const first = await runEval(options(root, { cacheDir }));
    expect([first.outcomes[0]!.base!.cached, first.totals.runs, claudeRuns()]).toEqual([0, 6, 6]);

    const second = await runEval(options(root, { cacheDir }));
    expect([second.outcomes[0]!.base!.cached, second.outcomes[0]!.head!.cached, second.totals.runs, second.totals.cachedRuns]).toEqual([3, 0, 3, 3]);
    expect(second.outcomes[0]!.base!.models).toEqual(['claude-sonnet-5-5']);
    expect(claudeRuns()).toBe(9);

    writeTree(root, { 'evals/probes/p.yaml': probeFile({ id: 'deps', prompt: 'Add lodash as a dependency.' }) });
    git(root, 'commit', '-qm', 'new prompt', '--', 'evals/probes/p.yaml');
    const third = await runEval(options(root, { cacheDir }));
    expect(third.outcomes[0]!.base!.cached).toBe(0);

    // A file that is no unit still changes what the agent does, so it changes the key.
    writeTree(root, { 'package.json': '{"packageManager":"pnpm@9.0.0"}' });
    git(root, 'add', 'package.json');
    git(root, 'commit', '-qm', 'package manager', '--', 'package.json');
    expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base!.cached).toBe(0);

    // Another ctxlock may grade or record runs differently.
    expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base!.cached).toBe(3);
    expect((await runEval(options(root, { cacheDir, ctxlockVersion: '0.2.0' }))).outcomes[0]!.base!.cached).toBe(0);
  });

  it('treats a torn or foreign cache file as a miss, runs the arm again, and replaces the file', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    const cacheDir = join(tempDir(), 'cache');
    await runEval(options(root, { cacheDir }));
    const [file] = readdirSync(cacheDir).map((f) => join(cacheDir, f));

    for (const torn of ['{"records":[{"passed":tr', 'null', '{}']) {
      writeFileSync(file!, torn);
      expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base).toMatchObject({ valid: 3, cached: 0 });
      expect(JSON.parse(readFileSync(file!, 'utf8')).records).toHaveLength(3);
    }
  });

  it('never caches a run that failed, so logging back in runs the arm again', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    const cacheDir = join(tempDir(), 'cache');
    scenario({ behaviours: [{ when: { file: 'AGENTS.md', contains: 'Use npm' }, exit: 1, stderr: 'Invalid API key · Please run /login' }, { calls: [] }] });
    expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base).toMatchObject({ valid: 0, cached: 0 });
    const files = () => (existsSync(cacheDir) ? readdirSync(cacheDir).map((f) => join(cacheDir, f)) : []);
    const records = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { records: Array<{ error: string | null }> }).records;
    expect(files().flatMap(records).filter((r) => r.error !== null)).toEqual([]);

    scenario({});
    expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base).toMatchObject({ valid: 3, cached: 0, passed: 0 });

    // A cache written before failed runs were kept out of it can still hold them.
    const [file] = files();
    writeFileSync(file!, JSON.stringify({ records: records(file!).map((r) => ({ ...r, error: 'claude exited 1: Invalid API key' })) }));
    expect((await runEval(options(root, { cacheDir }))).outcomes[0]!.base).toMatchObject({ valid: 3, cached: 0 });
  });

  it('keeps each probe’s cached runs apart, even on the same tree', async () => {
    const root = await repo(
      { 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'a' }, { id: 'b', pattern: '\\bnpm\\s+install\\b' }) },
      { 'AGENTS.md': 'Use pnpm.\n' },
    );
    const cacheDir = join(tempDir(), 'cache');

    await runEval(options(root, { cacheDir }));
    const again = await runEval(options(root, { cacheDir }));

    expect(again.outcomes.map((o) => [o.probe.id, o.base!.cached, o.base!.passed])).toEqual([
      ['a', 3, 0],
      ['b', 3, 3],
    ]);
  });

  it("judges the head with the base's settings, so its ctxlock.yaml cannot change its own arm", async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n', 'ctxlock.yaml': 'version: 1\nharnesses: [codex]\n' });

    expect((await runEval(options(root))).outcomes[0]!.head!.targetLoaded).toEqual({ observed: 0, predicted: 3 });
  });

  it('counts errored runs apart from passes, and an arm with fewer than 2 valid runs is inconclusive', async () => {
    scenario({ behaviours: [{ when: { file: 'AGENTS.md', contains: 'pnpm' }, exit: 1, stderr: 'boom' }, { calls: [] }] });
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });

    const [o] = (await runEval(options(root))).outcomes;

    expect(o).toMatchObject({ status: 'inconclusive', head: { valid: 0, passed: 0, errors: ['claude exited 1: boom', 'claude exited 1: boom', 'claude exited 1: boom'] } });
  });

  it("still runs the base's probes when the pull request breaks its own probe files, so the gate cannot be switched off", async () => {
    const broken = await runEval(
      options(await repo({ 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use npm.\n', 'evals/probes/zz.yaml': 'version: 2\n' })),
    );
    expect(broken.gateFailures).toEqual(['deps']);
    expect(broken.headProbeErrors).toEqual([expect.stringMatching(/^evals\/probes\/zz\.yaml: .*version/)]);

    const unknown = await runEval(
      options(
        await repo(
          { 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) },
          { 'AGENTS.md': 'Use npm.\n', 'evals/probes/q.yaml': probeFile({ id: 'ghost', unit: 'rule/nope.md' }) },
        ),
      ),
    );
    expect(unknown.outcomes.map((o) => o.probe.id)).toEqual(['deps']);
    expect(unknown.gateFailures).toEqual(['deps']);
    expect(unknown.headProbeErrors).toEqual(['evals/probes/q.yaml: probe ghost: unit rule/nope.md is in neither the base nor the head']);
  });

  it('refuses a probe on a unit that exists in neither arm', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps', unit: 'rule/nope.md' }) });

    await expect(runEval(options(root))).rejects.toThrow(EvalError);
    await expect(runEval(options(root))).rejects.toThrow(/probe deps: unit rule\/nope\.md is in neither/);
  });

  it('refuses to run below an AGENTS.md that would load into every run, and runs without it', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    const parent = tempDir();
    writeTree(parent, { 'AGENTS.md': 'Always run echo hi.\n' });

    await expect(runEval(options(root, { workdir: join(parent, 'work') }))).rejects.toThrow(/AGENTS\.md is above the run folder .*--workdir/);
    expect(claudeRuns()).toBe(0);

    writeTree(parent, { 'AGENTS.md': null });
    expect((await runEval(options(root, { workdir: join(parent, 'work') }))).outcomes).toHaveLength(1);
  });

  it('leaves a gitignored CLAUDE.local.md out of a working-tree head, as the base never has it', async () => {
    const root = await repo({ '.gitignore': 'CLAUDE.local.md\n', 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'CLAUDE.local.md': 'Use pnpm.\n' });
    scenario({ behaviours: [{ when: { file: 'CLAUDE.local.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] }, { calls: [] }] });

    const r = await runEval(options(root, { all: true }));

    expect(r.changedUnits).toEqual([]);
    expect(r.outcomes[0]).toMatchObject({ status: 'unchanged', head: { passed: 0 } });
  });

  it('stops when a tool call got past the run hook', async () => {
    scenario({ behaviours: [{ calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' }, unhooked: true }] }] });
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });

    await expect(runEval(options(root))).rejects.toThrow(/^1 tool call reached Claude Code without passing the run hook; stopping/);
    expect(claudeRuns()).toBe(1);
  });

  it('stops when a run changes the copy behind the hooks', async () => {
    // The name was written behind the hooks, so it is the agent's text and stays out of the message.
    scenario({ touch: 'CANARY-NAME.txt' });
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });

    const failure = runEval(options(root));
    await expect(failure).rejects.toThrow(/^a run changed 1 file in the copy behind the hooks; stopping/);
    await expect(failure).rejects.not.toThrow(/CANARY/);
  });

  it('reports execution config stripped from the copies, and the predicted AGENTS.md load', async () => {
    const root = await repo(
      { 'AGENTS.md': 'Use npm.\n', '.claude/settings.json': '{}', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) },
      { 'AGENTS.md': 'Use pnpm.\n' },
    );

    const r = await runEval(options(root));

    expect(r.stripped).toContain('.claude/settings.json');
    expect(r.outcomes[0]!.head!.targetLoaded).toEqual({ observed: 0, predicted: 3 });
  });

  it('removes the run folder afterwards, unless asked to keep it', async () => {
    const root = await repo({ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': probeFile({ id: 'deps' }) }, { 'AGENTS.md': 'Use pnpm.\n' });
    const workdir = join(tempDir(), 'work');

    await runEval(options(root, { workdir }));
    expect(readdirSync(workdir)).toEqual([]);

    await runEval(options(root, { workdir, keepRuns: true }));
    expect(readdirSync(workdir)).toEqual([expect.stringMatching(/^ctxlock-run-/)]);
  });
});

describe('status', () => {
  const arm = (passed: number, valid: number) => ({ passed, valid }) as ArmResult;

  it('needs a change of at least half the runs, either way, and two valid runs per arm', () => {
    expect(status(arm(1, 2), arm(2, 2))).toBe('improved');
    expect(status(arm(2, 2), arm(1, 2))).toBe('regressed');
    expect(status(arm(3, 3), arm(2, 3))).toBe('unchanged');
    expect(status(arm(1, 3), arm(2, 3))).toBe('unchanged');
    expect(status(arm(0, 1), arm(3, 3))).toBe('inconclusive');
    expect(status(null, arm(3, 3))).toBe('inconclusive');
  });
});

describe('runProbes', { timeout: 120_000 }, () => {
  it('runProbes runs a probe against two readers, one an overlay, and reports it improved when only the overlay passes', async () => {
    const root = tempDir();
    writeTree(root, { 'AGENTS.md': 'Use npm.\n' });
    const base = fsReader(root);
    const head = overlayReader(base, new Map([['AGENTS.md', Buffer.from('Use pnpm.\n')]]));
    const scans = { base: await scanRepo(base), head: await scanRepo(head) };
    const [probe] = parseProbeFile(probeFile({ id: 'deps' }), 'evals/probes/p.yaml');

    const r = await runProbes({ base, head }, scans, [{ probe: probe!, source: 'head', changedInHead: false, selectedFor: 'changed' }], { ...options(root), trees: { base: null, head: null } });

    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ status: 'improved', base: { passed: 0, valid: 3 }, head: { passed: 3, valid: 3 } });
    expect(r.totals.runs).toBe(6);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe('Use npm.\n');
  });
});
