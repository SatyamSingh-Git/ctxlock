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

function result(code: string, failOnMust: string) {
  return spawnSync(BASH, ['-c', script('Result')], { env: { ...process.env, CODE: code, FAIL_ON_MUST: failOnMust }, encoding: 'utf8' }).status;
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
});
