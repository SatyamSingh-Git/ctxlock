import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cleanup, git, gitRepo, tempDir } from './helpers/repo.js';

afterAll(cleanup);

// Plain `bash` on Windows is WSL, which cannot see this file system the same way.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const steps = (parse(readFileSync('templates/ctxlock-sync.yml', 'utf8')) as { jobs: { sync: { steps: Array<{ name?: string; run?: string }> } } }).jobs.sync.steps;
const script = (name: string) => steps.find((s) => s.name === name)!.run!;

// A consumer repository with a bare origin, a stand-in for ctxlock that writes `writes` and exits with
// `exit`, and a stand-in gh that logs its arguments and lists `open` as the open pull request.
async function workflow({ exit = 0, writes = {} as Record<string, string>, open = '', token = '', diverged = false } = {}) {
  const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n' }]);
  const origin = tempDir();
  git(origin, 'init', '-q', '--bare');
  git(dir, 'remote', 'add', 'origin', origin);
  if (diverged) {
    // An earlier run's branch, on history main no longer shares.
    git(dir, 'checkout', '-q', '--orphan', 'old');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'old sync');
    git(dir, 'push', '-q', 'origin', 'old:ctxlock/sync');
    git(dir, 'checkout', '-q', '-f', 'main');
  }
  const temp = tempDir();
  mkdirSync(join(temp, 'ctxlock/dist'), { recursive: true });
  writeFileSync(
    join(temp, 'ctxlock/dist/cli.js'),
    `const fs = require('node:fs');
for (const [path, text] of Object.entries(${JSON.stringify(writes)})) fs.writeFileSync(path, text);
process.stdout.write('### ctxlock · sync\\n' + JSON.stringify({ args: process.argv.slice(2), key: process.env.GIT_CONFIG_KEY_0 ?? null }) + '\\n');
process.exit(${exit});`,
  );
  const bin = join(temp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${join(temp, 'gh.log').replaceAll('\\', '/')}"\nif [ "$1 $2" = "pr list" ]; then printf '%s' '${open}'; fi\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(temp, 'summary.md'), '');
  const env = { ...process.env, RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: join(temp, 'summary.md'), UPSTREAM_TOKEN: token, GH_TOKEN: 'x', PATH: `${bin}${delimiter}${process.env.PATH}` };
  const run = (name: string) => spawnSync(BASH, ['-c', script(name)], { cwd: dir, env, encoding: 'utf8' }).status;
  const sync = run('Sync');
  const pr = sync === 0 ? run('Pull request') : null;
  const log = existsSync(join(temp, 'gh.log')) ? readFileSync(join(temp, 'gh.log'), 'utf8') : '';
  const pushed = spawnSync('git', ['-C', origin, 'show', 'ctxlock/sync:ctxlock.lock'], { encoding: 'utf8' });
  return { sync, pr, log, body: readFileSync(join(temp, 'body.md'), 'utf8'), summary: readFileSync(join(temp, 'summary.md'), 'utf8'), pushed: pushed.status === 0 ? pushed.stdout : null };
}

describe('the sync workflow template', { timeout: 60_000 }, () => {
  it('commits what sync wrote to ctxlock/sync and opens one pull request with its markdown, or updates the open one', async () => {
    const opened = await workflow({ writes: { 'ctxlock.lock': 'lockfile_version: 1\n' } });
    expect([opened.sync, opened.pr]).toEqual([0, 0]);
    expect(opened.body).toContain('"args":["sync","--format","markdown"]');
    expect(opened.summary).toBe(opened.body);
    expect(opened.pushed).toBe('lockfile_version: 1\n');
    expect(opened.log).toMatch(/^pr list --head ctxlock\/sync --state open --json number --jq \.\[\]\.number\npr create --head ctxlock\/sync --title ctxlock sync --body-file .*body\.md\n$/);

    const updated = await workflow({ writes: { 'ctxlock.lock': 'lockfile_version: 1\n' }, open: '7', diverged: true });
    expect(updated.pushed).toBe('lockfile_version: 1\n');
    expect(updated.log).toMatch(/\npr edit ctxlock\/sync --body-file .*body\.md\n$/);
  });

  it('with nothing changed, pushes nothing and calls no gh', async () => {
    const quiet = await workflow();
    expect([quiet.sync, quiet.pr, quiet.log, quiet.pushed]).toEqual([0, 0, '', null]);
  });

  it('fails the job on a refusal or an error, after putting the report in the job summary', async () => {
    for (const exit of [1, 2]) {
      const failed = await workflow({ exit, writes: { 'x.md': 'x' } });
      expect([failed.sync, failed.pr, failed.pushed]).toEqual([exit, null, null]);
      expect(failed.summary).toContain('### ctxlock · sync');
    }
  });

  it("gives sync's git a private upstream's token only when there is one", async () => {
    expect((await workflow({ token: 'secret-token' })).body).toContain('"key":"url.https://x-access-token:secret-token@github.com/.insteadOf"');
    expect((await workflow()).body).toContain('"key":null');
  });
});
