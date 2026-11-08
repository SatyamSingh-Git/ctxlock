import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { cleanup, gitRepo, tempDir, writeTree } from './helpers/repo.js';

afterAll(cleanup);
// No test reads the developer's own recorded sessions.
beforeEach(() => {
  vi.stubEnv('CTXLOCK_HOME', tempDir());
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

describe('ctxlock CLI', () => {
  it('lint exits 1 on a repo containing U+200B and 0 after it is removed', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': `Use pnpm.${String.fromCodePoint(0x200b)}\n` });

    const flagged = await cli('lint', dir);
    expect(flagged.code).toBe(1);
    expect(flagged.stdout).toContain('L1-hidden-unicode');
    expect((await cli('scan', dir)).code).toBe(0);
    expect((await cli('budget', dir)).code).toBe(0);

    writeTree(dir, { 'AGENTS.md': 'Use pnpm.\n' });
    expect((await cli('lint', dir)).code).toBe(0);
  });

  it('lint exits 2 and prints the RegistryError message for an invalid ctxlock.yaml', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', 'ctxlock.yaml': 'version: 2\n' });

    const { code, stdout, stderr } = await cli('lint', dir);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^ctxlock\.yaml: version: /);
  });

  it('an unexpected error exits 2 with its message and no stack trace, never 1, which means must-fix', async () => {
    const dir = tempDir();
    const deep = `${'['.repeat(20000)}${']'.repeat(20000)}`;
    writeTree(dir, { 'AGENTS.md': 'a', '.claude/settings.json': `{ "env": { "X": ${deep} } }` });

    const { code, stderr } = await cli('lint', dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^ctxlock could not run: /);
    expect(stderr).not.toMatch(/\n\s+at /);
  });

  it('bad arguments exit 2', async () => {
    const dir = tempDir();

    expect((await cli('lint', dir, '--format', 'xml')).code).toBe(2);
    expect((await cli('lint', join(dir, 'missing'))).code).toBe(2);
    expect((await cli('frobnicate')).code).toBe(2);
    expect((await cli('lint', '--help')).code).toBe(0);
  });

  it('--format json never contains unit text', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'The sentinel phrase is purple-elephant-42.\n', '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: Writes notes\n---\nsecret-steps-17\n' });

    for (const view of ['scan', 'lint', 'budget']) {
      const { code, stdout } = await cli(view, dir, '--format', 'json');
      expect(code).toBe(0);
      expect(stdout).not.toMatch(/purple-elephant-42|secret-steps-17/);
      expect(JSON.parse(stdout)).toMatchObject({ version: 1, root: dir, ref: null });
    }
    const json = async (view: string) => JSON.parse((await cli(view, dir, '--format', 'json')).stdout);
    const scan = await json('scan');
    expect(Object.keys(scan)).toEqual(['version', 'root', 'ref', 'units', 'contexts', 'budget', 'findings']);
    expect(Object.keys(await json('lint'))).toEqual(['version', 'root', 'ref', 'findings']);
    expect(Object.keys(await json('budget'))).toEqual(['version', 'root', 'ref', 'budget']);
    expect(Object.keys(scan.units[0])).toEqual(['id', 'kind', 'path', 'name', 'digest', 'aliases']);
  });

  it('budget prints one row per site and harness', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a'.repeat(100), 'pkg/AGENTS.md': 'b'.repeat(50) });

    const lines = (await cli('budget', dir)).stdout.trimEnd().split('\n');
    expect(lines).toEqual([
      expect.stringMatching(/^harness\s+site\s+always bytes\s+skill catalog\s+cut$/),
      expect.stringMatching(/^claude-code\s+\.\s+100\s+0\s+-$/),
      expect.stringMatching(/^claude-code\s+pkg\s+150\s+0\s+-$/),
      expect.stringMatching(/^codex\s+\.\s+100 \/ 32768\s+0 \/ 8000\s+-$/),
      expect.stringMatching(/^codex\s+pkg\s+150 \/ 32768\s+0 \/ 8000\s+-$/),
    ]);
  });

  it('scan lists the units, what each agent loads, and a count of findings', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.claude/rules/style.md': 'Use tabs.' });

    const { code, stdout } = await cli('scan', dir);
    expect(code).toBe(0);
    expect(stdout).toContain('2 units');
    expect(stdout).toMatch(/instructions\s+AGENTS\.md/);
    expect(stdout).toMatch(/rule\s+\.claude\/rules\/style\.md/);
    expect(stdout).toMatch(/claude-code at \.: 2 always/);
    expect(stdout).toMatch(/codex at \.: 1 always/);
    expect(stdout).toMatch(/findings: 0 must, 0 should, \d+ info/);
  });
});

describe('ctxlock eval', { timeout: 120_000 }, () => {
  // Relative on purpose: the CLI resolves --claude against its own working directory, not the copy's.
  const FAKE = 'tests/helpers/fake-claude.mjs';
  const PROBES = "version: 1\nprobes:\n  - id: deps\n    unit: instructions/AGENTS.md\n    prompt: Add zod as a dependency.\n    expect:\n      command: 'pnpm add'\n";

  beforeEach(() => {
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        behaviours: [
          { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'npm install zod' } }] },
        ],
      }),
    );
    process.env.FAKE_CLAUDE_SCENARIO = file;
    process.env.XDG_CACHE_HOME = tempDir();
  });

  async function repo(base: string, head: string, extra: Record<string, string> = {}, headExtra: Record<string, string> = {}) {
    const { dir } = await gitRepo([{ 'AGENTS.md': base, 'evals/probes/p.yaml': PROBES, ...extra }]);
    writeTree(dir, { 'AGENTS.md': head, ...headExtra });
    return dir;
  }
  const evalCli = (dir: string, ...args: string[]) => cli('eval', dir, '--base', 'HEAD', '--claude', FAKE, '--workdir', join(tempDir(), 'w'), ...args);

  it('runs the probes on the changed units and prints a report, exiting 0', async () => {
    const { code, stdout } = await evalCli(await repo('Use npm.\n', 'Use pnpm.\n'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/deps\s+instructions\/AGENTS\.md\s+base 0\/3\s+head 3\/3\s+improved/);
  });

  it('exits 1 only with --fail-on-regression and a gated regression', async () => {
    const dir = await repo('Use pnpm.\n', 'Use npm.\n');
    expect((await evalCli(dir)).code).toBe(0);
    const gated = await evalCli(dir, '--fail-on-regression');
    expect(gated.code).toBe(1);
    expect(gated.stdout).toContain('Gated regressions: deps');
  });

  it('exits 2 with the reason when Claude Code is missing, outside git, or a probe file is broken', async () => {
    const dir = await repo('Use npm.\n', 'Use pnpm.\n');
    const missing = await cli('eval', dir, '--base', 'HEAD', '--claude', 'ctxlock-no-such-claude', '--workdir', join(tempDir(), 'w'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/^Claude Code not found/);

    const plain = tempDir();
    expect((await evalCli(plain)).stderr).toMatch(/not inside a git repository/);

    const broken = await repo('Use npm.\n', 'Use pnpm.\n', { 'evals/probes/q.yaml': 'version: 2\n' });
    const probeError = await evalCli(broken);
    expect(probeError.code).toBe(2);
    expect(probeError.stderr).toMatch(/^evals\/probes\/q\.yaml: /);
  });

  it('writes a markdown section for a failure when the report is markdown', async () => {
    const { code, stdout } = await cli('eval', await repo('Use npm.\n', 'Use pnpm.\n'), '--base', 'HEAD', '--claude', 'ctxlock-no-such-claude', '--format', 'markdown', '--workdir', join(tempDir(), 'w'));
    expect(code).toBe(2);
    expect(stdout).toMatch(/could not run: `Claude Code not found/);
  });

  it('prints no agent text on stdout or stderr, in any format, even when a run stops the check', async () => {
    const useScenario = (s: Record<string, unknown>) => {
      const file = join(tempDir(), 'scenario.json');
      writeFileSync(file, JSON.stringify(s));
      process.env.FAKE_CLAUDE_SCENARIO = file;
    };
    useScenario({ behaviours: [{ calls: [{ tool: 'Bash', input: { command: 'echo CANARY-command' } }, { tool: 'Write', input: { file_path: 'CANARY-edit.txt', content: 'x' } }] }], text: 'CANARY-reply' });
    const dir = await repo('Use npm.\n', 'Use pnpm.\n');

    for (const format of ['text', 'json', 'markdown']) {
      const r = await evalCli(dir, '--format', format, '--keep-runs', '--fail-on-regression');
      expect(r.code, format).toBe(0);
      expect(r.stdout + r.stderr, format).not.toMatch(/CANARY/);
    }

    useScenario({ touch: 'CANARY-touched.txt' });
    for (const format of ['text', 'markdown']) {
      const stopped = await evalCli(dir, '--format', format);
      expect(stopped.code, format).toBe(2);
      expect(stopped.stdout + stopped.stderr, format).not.toMatch(/CANARY/);
    }
  });

  it("caches in the user's own cache folder by default, not in the work folder, which may be a shared temp folder", async () => {
    const dir = await repo('Use npm.\n', 'Use pnpm.\n');
    const workdir = join(tempDir(), 'w');

    await cli('eval', dir, '--base', 'HEAD', '--claude', FAKE, '--workdir', workdir);
    expect(readdirSync(join(process.env.XDG_CACHE_HOME!, 'ctxlock'))).toHaveLength(1);
    expect(existsSync(join(workdir, 'ctxlock-cache'))).toBe(false);

    const own = join(tempDir(), 'mine');
    await cli('eval', dir, '--base', 'HEAD', '--claude', FAKE, '--workdir', workdir, '--cache', own);
    expect(readdirSync(own)).toHaveLength(1);
  });

  it("takes eval settings from the base ctxlock.yaml, not the head's, and flags override them", async () => {
    const dir = await repo('Use npm.\n', 'Use pnpm.\n', { 'ctxlock.yaml': 'version: 1\neval:\n  runs: 2\n' }, { 'ctxlock.yaml': 'version: 1\neval:\n  runs: 1\n' });
    expect(JSON.parse((await evalCli(dir, '--format', 'json')).stdout).runsPerArm).toBe(2);
    expect(JSON.parse((await evalCli(dir, '--format', 'json', '--runs', '3')).stdout).runsPerArm).toBe(3);
  });
});

describe('ctxlock build', { timeout: 120_000 }, () => {
  const SKILL = '---\nname: release\ndescription: Releases the project\n---\nRun it.\n';

  it('reports a gap and writes nothing; --fill-missing writes it once; lint then sees no gap', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n', '.agents/skills/release/SKILL.md': SKILL }]);

    const report = await cli('build', dir);
    expect(report.code).toBe(0);
    expect(report.stdout).toMatch(/\.agents\/skills\/release does not reach claude-code\s+fill: \.claude\/skills\/release/);
    expect(existsSync(join(dir, '.claude/skills/release/SKILL.md'))).toBe(false);

    const filled = await cli('build', dir, '--fill-missing');
    expect(filled.code).toBe(0);
    expect(filled.stdout).toContain('Wrote:\n  .claude/skills/release/SKILL.md');
    expect(filled.stdout).not.toContain('--fill-missing writes');
    expect(existsSync(join(dir, '.ctxlock/generated.json'))).toBe(true);

    expect((await cli('build', dir, '--fill-missing')).stdout).not.toContain('Wrote:');
    expect((await cli('lint', dir)).stdout).not.toContain('L11-coverage');
  });

  it('shows the budget as it stands after a fill', async () => {
    const { dir } = await gitRepo([{ 'CLAUDE.md': 'Use pnpm.\n' }]);
    expect((await cli('build', dir)).stdout).toMatch(/Budget:\n.*\n.*\ncodex\s+\.\s+0 \/ 32768/);
    expect((await cli('build', dir, '--fill-missing')).stdout).toMatch(/Budget:\n.*\n.*\ncodex\s+\.\s+10 \/ 32768/);
  });

  it('reports what it generated as it stands after the fill, not before', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n', '.agents/skills/release/SKILL.md': SKILL }]);
    const upToDate = /Generated \(\.ctxlock\/generated\.json\):\n\s+\.claude\/skills\/release\/SKILL\.md\s+up to date/;

    expect((await cli('build', dir, '--fill-missing')).stdout).toMatch(upToDate);

    writeTree(dir, { '.agents/skills/release/SKILL.md': SKILL.replace('Run it.', 'Run it twice.') });
    expect((await cli('build', dir)).stdout).toMatch(/\.claude\/skills\/release\/SKILL\.md\s+stale: \.agents\/skills\/release\/SKILL\.md changed/);
    expect((await cli('build', dir, '--fill-missing')).stdout).toMatch(upToDate);

    writeTree(dir, { '.agents/skills/release/notes.md': 'n' });
    await cli('build', dir, '--fill-missing');
    writeTree(dir, { '.agents/skills/release/notes.md': null });
    const removed = await cli('build', dir, '--fill-missing');
    expect(removed.stdout).toContain('Removed, since its source is gone:\n  .claude/skills/release/notes.md');
    expect(removed.stdout).not.toMatch(/notes\.md\s+\.agents/);
  });

  it('ignores a personal CLAUDE.local.md, and writes at the top of the repository when run from a folder in it', async () => {
    const { dir } = await gitRepo([{ '.gitignore': 'CLAUDE.local.md\n', 'AGENTS.md': 'Use pnpm.\n', 'sub/x.ts': '' }]);
    writeTree(dir, { 'CLAUDE.local.md': 'Mine.\n' });
    const quiet = await cli('build', dir);
    expect(quiet.stdout).toContain('No gaps between the configured agents.');
    expect(quiet.stdout).not.toContain('Budget after');

    writeTree(dir, { '.agents/skills/release/SKILL.md': SKILL });
    await cli('build', join(dir, 'sub'), '--fill-missing');
    expect(existsSync(join(dir, '.claude/skills/release/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'sub/.claude'))).toBe(false);
  });

  it('prints a suggested docs index and writes nothing', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', 'docs/a.md': '# A\n' }]);

    const { code, stdout } = await cli('build', dir, '--suggest-index', 'docs');
    expect(code).toBe(0);
    expect(stdout).toBe('[docs index]|root: ./docs|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|.:{a.md}\n\n108 bytes. Not written. Measure it with a probe before you commit it: see the-guide/build.md.\n');
  });

  it('takes the index folder from the directory it runs on, as ., a subfolder, or an absolute path inside the repository', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', 'docs/a.md': '# A\n', 'sub/docs/b.md': '# B\n' }]);
    const index = async (from: string, folder: string) => (await cli('build', from, '--suggest-index', folder)).stdout.split('|')[0];

    expect(await index(dir, '.')).toBe('[. index]');
    expect(await index(dir, `.${sep}docs${sep}`)).toBe('[docs index]');
    expect(await index(join(dir, 'sub'), 'docs')).toBe('[sub/docs index]');
    expect(await index(join(dir, 'sub'), join(dir, 'docs'))).toBe('[docs index]');

    const outside = await cli('build', dir, '--suggest-index', tempDir());
    expect([outside.code, outside.stderr]).toEqual([2, expect.stringMatching(/ is outside the repository\n$/)]);
  });

  it('finds the index folder from a directory given by another name than git gives it: an 8.3 short name, or a symlink', async () => {
    // GitHub's Windows runners give the temp folder by its 8.3 short name; git gives the long one.
    const otherName = (dir: string) => {
      if (process.platform === 'win32') {
        return execFileSync('powershell', ['-NoProfile', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir}').ShortPath`], { encoding: 'utf8' }).trim();
      }
      const link = join(tempDir(), 'link');
      symlinkSync(dir, link);
      return link;
    };
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', 'docs/a.md': '# A\n' }]);
    const other = otherName(dir);
    expect(other).not.toBe(dir);

    expect((await cli('build', other, '--suggest-index', 'docs')).stdout.split('|')[0]).toBe('[docs index]');
    expect((await cli('build', other, '--suggest-index', 'nope')).stderr).toBe('no markdown files under nope\n');
    expect((await cli('build', dir, '--suggest-index', join(other, 'docs'))).stdout.split('|')[0]).toBe('[docs index]');

    // Outside git, the directory itself is where the folder is read from.
    const plain = tempDir();
    writeTree(plain, { 'docs/a.md': '# A\n' });
    expect((await cli('build', otherName(plain), '--suggest-index', 'docs')).stdout.split('|')[0]).toBe('[docs index]');
  });

  it('exits 2 for a path that is no directory, a folder with no markdown, and a fill over an unreadable record', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.ctxlock/generated.json': '{' }]);

    expect((await cli('build', join(dir, 'nope'))).code).toBe(2);
    const report = await cli('build', dir);
    expect(report.code).toBe(0);
    expect(report.stdout).toMatch(/\n\.ctxlock\/generated\.json is not valid: .*; fix it before --fill-missing, which would replace it\n/);
    const noDocs = await cli('build', dir, '--suggest-index', 'docs');
    expect([noDocs.code, noDocs.stderr]).toEqual([2, 'no markdown files under docs\n']);
    const broken = await cli('build', dir, '--fill-missing');
    expect(broken.code).toBe(2);
    expect(broken.stderr).toMatch(/^\.ctxlock\/generated\.json is not valid: .*; fix it first: --fill-missing would replace it/);
    expect(existsSync(join(dir, '.claude/skills/release/SKILL.md'))).toBe(false);
  });
});

describe('ctxlock who-uses and ctxlock impact', { timeout: 120_000 }, () => {
  const files = {
    '.claude/rules/a.md': 'Use pnpm.\n',
    '.claude/rules/b.md': 'Run pnpm test.\n',
    '.claude/rules/c.md': 'Run pnpm lint.\n',
    '.github/CODEOWNERS': '.claude/rules/a.md @rules-team\n',
    'ctxlock.yaml':
      'version: 1\nunits:\n  .claude/rules/b.md:\n    depends-on: [.claude/rules/a.md]\n  .claude/rules/c.md:\n    depends-on: [.claude/rules/b.md]\nconsumers:\n  payments-api:\n    owner: "@payments-team"\n    depends-on: [.claude/rules/c.md]\n',
  };

  it("who-uses gives one answer for a unit's path and its ID, and exits 2 for no unit", async () => {
    const { dir } = await gitRepo([files]);

    const byPath = await cli('who-uses', '.claude/rules/a.md', dir);
    expect(byPath.code).toBe(0);
    expect(byPath.stdout).toContain('Units that depend on it:\n  .claude/rules/b.md\n  .claude/rules/c.md  through .claude/rules/b.md');
    expect((await cli('who-uses', 'rule/.claude/rules/a.md', dir)).stdout).toBe(byPath.stdout);

    const none = await cli('who-uses', 'x', dir);
    expect([none.code, none.stderr]).toEqual([2, 'no unit at x\n']);
  });

  it('impact lists what a change reaches and whose approval it needs; with no ctxlock.yaml, the changes only', async () => {
    const { dir } = await gitRepo([files, { '.claude/rules/a.md': 'Use pnpm, always.\n' }]);
    const reached = await cli('impact', dir, '--base', 'HEAD~1');
    expect(reached.code).toBe(0);
    expect(reached.stdout).toContain('Depends on what changed:\n  .claude/rules/b.md\n  .claude/rules/c.md  through .claude/rules/b.md');
    expect(reached.stdout).toContain('Owners to ask: @payments-team, @rules-team');

    const { 'ctxlock.yaml': _, '.github/CODEOWNERS': __, ...plain } = files;
    const { dir: bare } = await gitRepo([plain, { '.claude/rules/a.md': 'Use npm.\n' }]);
    expect((await cli('impact', bare, '--base', 'HEAD~1')).stdout).toBe('ctxlock impact\n\nChanged:\n  .claude/rules/a.md  modified\n');

    const missing = await cli('impact', dir, '--base', 'nope');
    expect([missing.code, missing.stderr]).toEqual([2, 'base ref nope not found — in GitHub Actions use actions/checkout with fetch-depth: 0\n']);
  });
});

describe('ctxlock loads', () => {
  it('lists what recorded sessions loaded, and who-uses shows them beside the prediction', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n', '.claude/rules/old.md': 'Old.\n' });
    // Claude Code reports the long path where Windows' temp folder has an 8.3 name.
    const real = realpathSync.native(dir);
    const line = (o: object) => JSON.stringify({ v: 1, ts: '2026-11-08T10:00:00.000Z', harness: 'claude-code', session: 's1', cwd: real, ...o });
    const home = tempDir();
    writeTree(home, {
      // The last load is of a file deleted since.
      'events/2026-11.jsonl': [
        line({ event: 'session_start', source: 'startup' }),
        line({ event: 'load', file: join(real, 'CLAUDE.md'), sha256: null, reason: 'session_start' }),
        line({ event: 'load', file: join(real, 'gone.md'), sha256: null, reason: 'session_start' }),
        '',
      ].join('\n'),
    });
    vi.stubEnv('CTXLOCK_HOME', home);

    const loads = await cli('loads', dir);
    expect(loads.code).toBe(0);
    expect(loads.stdout).toBe(`ctxlock loads · 1 Claude Code session, 2026-11-08

Loaded:
  CLAUDE.md  1 session  session_start  last 2026-11-08

Not loaded in these sessions:
  .claude/rules/old.md  always

These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.
`);
    expect((await cli('who-uses', 'CLAUDE.md', dir)).stdout).toContain('Loaded in sessions (observed):\n  claude-code  1 of 1 session  session_start  last 2026-11-08\n');
    expect((await cli('who-uses', '.claude/rules/old.md', dir)).stdout).toContain('Loaded in sessions (observed):\n  claude-code  0 of 1 session\n');
  });

  it('matches sessions recorded under the real path of the folder and under a link to it', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n' });
    const real = realpathSync.native(dir);
    const link = join(tempDir(), 'link');
    symlinkSync(real, link, 'junction');
    const line = (session: string, top: string) =>
      JSON.stringify({ v: 1, ts: '2026-11-08T10:00:00.000Z', harness: 'claude-code', session, cwd: top, event: 'load', file: join(top, 'CLAUDE.md'), sha256: null, reason: 'session_start' });
    const home = tempDir();
    writeTree(home, { 'events/2026-11.jsonl': `${line('s1', real)}\n${line('s2', link)}\n` });
    vi.stubEnv('CTXLOCK_HOME', home);

    expect((await cli('loads', link)).stdout).toContain('ctxlock loads · 2 Claude Code sessions');
    expect((await cli('loads', real)).stdout).toContain('ctxlock loads · 2 Claude Code sessions');
  });

  it('who-uses shows recorded sessions only for a unit whose loads Claude Code can report', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'Use pnpm.\n', 'packages/web/AGENTS.md': 'web\n', '.claude/settings.json': '{}\n' });
    const real = realpathSync.native(dir);
    const home = tempDir();
    writeTree(home, {
      'events/2026-11.jsonl': `${JSON.stringify({ v: 1, ts: '2026-11-08T10:00:00.000Z', harness: 'claude-code', session: 's1', cwd: real, event: 'session_start', source: 'startup' })}\n`,
    });
    vi.stubEnv('CTXLOCK_HOME', home);

    expect((await cli('who-uses', 'AGENTS.md', dir)).stdout).toContain('Loaded in sessions (observed):\n  claude-code  1 of 1 session  session_start (predicted)');
    expect((await cli('who-uses', 'packages/web/AGENTS.md', dir)).stdout).not.toContain('observed');
    expect((await cli('who-uses', '.claude/settings.json', dir)).stdout).not.toContain('observed');
  });

  it('says how to install the collector when nothing was recorded, and exits 2 for a folder that is not one', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n' });

    const loads = await cli('loads', dir);
    expect(loads.code).toBe(0);
    expect(loads.stdout).toContain('claude plugin install ctxlock@ctxlock');
    expect((await cli('who-uses', 'CLAUDE.md', dir)).stdout).not.toContain('observed');

    const file = await cli('loads', join(dir, 'CLAUDE.md'));
    expect(file.code).toBe(2);

    // A static query does not depend on the collector's store.
    const broken = tempDir();
    writeTree(broken, { events: 'not a folder\n' });
    vi.stubEnv('CTXLOCK_HOME', broken);
    expect((await cli('who-uses', 'CLAUDE.md', dir)).code).toBe(0);
  });
});

describe('ctxlock probe draft', { timeout: 120_000 }, () => {
  const draftReply = "```yaml\nprobes:\n  - id: deps-use-pnpm\n    prompt: Add zod as a dependency.\n    expect:\n      command: 'pnpm add'\n```\n";

  beforeEach(() => {
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(
      file,
      JSON.stringify({
        behaviours: [
          { when: { promptContains: 'Draft' }, calls: [], text: draftReply },
          { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'npm install zod' } }] },
        ],
      }),
    );
    process.env.FAKE_CLAUDE_SCENARIO = file;
  });

  it('writes the probes that tell the copies apart, and says what it kept', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n' }]);

    const { code, stdout } = await cli('probe', 'draft', dir, '--unit', 'instructions/AGENTS.md', '--claude', 'tests/helpers/fake-claude.mjs', '--workdir', join(tempDir(), 'w'));

    expect(code).toBe(0);
    expect(stdout).toContain('Wrote evals/probes/agents-md.yaml: 1 kept. Review it before committing.');
    expect(stdout).toMatch(/kept\s+deps-use-pnpm/);
    expect(stdout).toContain('Runs: 5');
  });

  it('prints the model-written ids and reasons with control characters replaced, so they cannot drive the terminal', async () => {
    // YAML's \e is ESC and \a is BEL: two in a kept id, one in an invalid candidate's regular expression.
    const reply = '```yaml\nprobes:\n  - id: "deps\\e[2J\\a"\n    prompt: Add zod as a dependency.\n    expect:\n      command: \'pnpm add\'\n  - id: broken\n    prompt: Add zod.\n    expect:\n      command: "((\\e[31m"\n```\n';
    const file = join(tempDir(), 'scenario.json');
    writeFileSync(file, JSON.stringify({ behaviours: [
      { when: { promptContains: 'Draft' }, calls: [], text: reply },
      { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }] },
      { calls: [{ tool: 'Bash', input: { command: 'npm install zod' } }] },
    ] }));
    process.env.FAKE_CLAUDE_SCENARIO = file;
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n' }]);

    const { stdout } = await cli('probe', 'draft', dir, '--unit', 'instructions/AGENTS.md', '--claude', 'tests/helpers/fake-claude.mjs', '--workdir', join(tempDir(), 'w'));

    const cp = String.fromCodePoint;
    expect(stdout).toMatch(/kept\s+deps\?\[2J\?/);
    expect(stdout).toMatch(/discarded\s+broken: invalid: .*\?\[31m/);
    expect(new RegExp(`[${cp(0)}-${cp(9)}${cp(11)}-${cp(31)}${cp(127)}-${cp(159)}]`).test(stdout)).toBe(false);
  });

  it('exits 2 rather than write over an existing probe file', async () => {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n', 'evals/probes/agents-md.yaml': 'mine\n' }]);

    const { code, stderr } = await cli('probe', 'draft', dir, '--unit', 'instructions/AGENTS.md', '--claude', 'tests/helpers/fake-claude.mjs', '--workdir', join(tempDir(), 'w'));

    expect(code).toBe(2);
    expect(stderr).toMatch(/^evals\/probes\/agents-md\.yaml already exists/);
  });
});
