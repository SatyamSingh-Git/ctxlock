import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cleanup, tempDir } from './helpers/repo.js';

afterAll(cleanup);

// Plain `bash` on Windows is WSL, which cannot see this file system the same way.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const steps = (parse(readFileSync('action.yml', 'utf8')) as { runs: { steps: Array<{ name?: string; run?: string }> } }).runs.steps;
const script = (name: string) => steps.find((s) => s.name === name)!.run!;

// The Check context step, run against a stand-in for dist/cli.js that prints `out` and exits with `exit`.
function check(base: string, exit: number, out = '') {
  const dir = tempDir();
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/cli.js'), `process.stdout.write(${JSON.stringify(out)}); process.stderr.write('raw stderr @octocat\\n'); process.exit(${exit});`);
  writeFileSync(join(dir, 'output'), '');
  const env = { ...process.env, GITHUB_ACTION_PATH: dir, GITHUB_WORKSPACE: dir, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'output'), BASE: base };
  const step = spawnSync(BASH, ['-c', script('Check context')], { env, encoding: 'utf8' });
  return { step: step.status, report: readFileSync(join(dir, 'ctxlock.md'), 'utf8'), code: /exit-code=(\S*)/.exec(readFileSync(join(dir, 'output'), 'utf8'))?.[1] };
}

function result(code: string, failOnMust: string, evalCode = '', failOnRegression = 'false') {
  const env = { ...process.env, CODE: code, FAIL_ON_MUST: failOnMust, EVAL_CODE: evalCode, FAIL_ON_REGRESSION: failOnRegression };
  return spawnSync(BASH, ['-c', script('Result')], { env, encoding: 'utf8' }).status;
}

// The Behavioral check step, after a static report, against a stand-in for dist/cli.js. The stand-in
// exits 9 for anything but eval, and prints which credentials and flags reached it.
function behavioral(vars: Record<string, string>, exit = 0, out = '### ctxlock · behavioral check\n') {
  const dir = tempDir();
  mkdirSync(join(dir, 'dist'));
  writeFileSync(
    join(dir, 'dist/cli.js'),
    `const [, , cmd, ...args] = process.argv;
if (cmd !== 'eval') process.exit(9);
if (${JSON.stringify(out)}) process.stdout.write(${JSON.stringify(out)} + JSON.stringify({ apiKey: process.env.ANTHROPIC_API_KEY ?? null, token: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null, raw: process.env.TOKEN ?? null, args }) + '\\n');
process.stderr.write('raw stderr @octocat\\n');
process.exit(${exit});`,
  );
  writeFileSync(join(dir, 'output'), '');
  writeFileSync(join(dir, 'ctxlock.md'), '### ctxlock · context check\n');
  const { ANTHROPIC_API_KEY: _key, CLAUDE_CODE_OAUTH_TOKEN: _token, ...inherited } = process.env;
  const env = { ...inherited, GITHUB_ACTION_PATH: dir, GITHUB_WORKSPACE: dir, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'output'), BASE: 'abc', EVAL: 'auto', TOKEN: '', KEY: '', FAIL_ON_REGRESSION: 'false', ...vars };
  const step = spawnSync(BASH, ['-c', script('Behavioral check')], { env, encoding: 'utf8' });
  const report = readFileSync(join(dir, 'ctxlock.md'), 'utf8');
  const seen = /^\{.*\}$/m.exec(report)?.[0];
  return { step: step.status, report, seen: seen ? JSON.parse(seen) : null, code: /exit-code=(\S*)/.exec(readFileSync(join(dir, 'output'), 'utf8'))?.[1] };
}

describe('the GitHub Action', () => {
  it("passes ctxlock's own report and exit code through", () => {
    expect(check('abc', 0, '### report\n')).toEqual({ step: 0, report: '### report\n', code: '0' });
    expect(check('abc', 1, '### must\n')).toEqual({ step: 0, report: '### must\n', code: '1' });
    expect(check('abc', 2, '### could not run: `x`\n')).toEqual({ step: 0, report: '### could not run: `x`\n', code: '2' });
  });

  it('a crash that leaves no report is "could not run", and raw stderr never reaches the comment', () => {
    for (const exit of [1, 134]) {
      const { report, code } = check('abc', exit);
      expect(code).toBe('2');
      expect(report).toContain(`ctxlock could not run (exit ${exit}). The job log has the reason.`);
      expect(report).not.toContain('octocat');
    }
  });

  it('a missing base is "could not run" with the reason', () => {
    const { report, code } = check('', 0);
    expect(code).toBe('2');
    expect(report).toContain('no base ref');
  });

  it('the Result step fails on must-fix unless fail-on-must is off, and on every other non-zero code', () => {
    expect([result('0', 'true'), result('1', 'true'), result('1', 'false'), result('2', 'false'), result('134', 'false'), result('', 'false')]).toEqual([0, 1, 0, 1, 1, 1]);
  });

  it('the Result step treats the behavioral check as advisory: only a gated regression, when asked for, fails', () => {
    expect([result('0', 'true', '2'), result('0', 'true', '1'), result('0', 'true', '1', 'true'), result('1', 'true', '0'), result('0', 'true', '')]).toEqual([0, 0, 1, 1, 0]);
  });

  it('skips the behavioral check without credentials, and says why', () => {
    const r = behavioral({});
    expect(r.step).toBe(0);
    expect(r.report).toBe('### ctxlock · context check\n\n#### Behavioral check\n\nSkipped: no Claude credentials. Pull requests from forks get no secrets.\n');
    expect(r.code).toBeUndefined();
  });

  it('appends the eval report after the static one, passing on only the credential that is set', () => {
    const r = behavioral({ TOKEN: 'tok' });
    expect(r.code).toBe('0');
    expect(r.report.startsWith('### ctxlock · context check\n\n### ctxlock · behavioral check\n')).toBe(true);
    expect(r.seen).toMatchObject({ apiKey: null, token: 'tok', raw: null });
    expect(r.seen.args).toEqual(expect.arrayContaining(['--base', 'abc', '--format', 'markdown', '--cache']));
    expect(r.seen.args).not.toContain('--fail-on-regression');

    expect(behavioral({ KEY: 'key', FAIL_ON_REGRESSION: 'true' }).seen).toMatchObject({ apiKey: 'key', token: null, args: expect.arrayContaining(['--fail-on-regression']) });
  });

  it('a behavioral check that crashes without a report says it could not run, and raw stderr stays out', () => {
    const r = behavioral({ TOKEN: 'tok' }, 2, '');
    expect(r.code).toBe('2');
    expect(r.report).toContain('Behavioral check could not run (exit 2). The job log has the reason.');
    expect(r.report).not.toContain('octocat');
  });

  it('adds nothing when eval is false', () => {
    const r = behavioral({ TOKEN: 'tok', EVAL: 'false' });
    expect(r.report).toBe('### ctxlock · context check\n');
    expect(r.code).toBeUndefined();
  });

  it('passes inputs to scripts only through env, never through ${{ }} inside them', () => {
    for (const step of steps) expect(step.run ?? '', step.name).not.toMatch(/\$\{\{/);
  });
});
