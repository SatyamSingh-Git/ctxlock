import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { draftName } from '../src/loop/draft.js';
import { serializeLock } from '../src/sync/lock.js';
import { cleanup, git, gitRepo, tempDir, writeTree } from './helpers/repo.js';

afterAll(cleanup);
// No test reads the developer's own recorded sessions.
beforeEach(() => {
  vi.stubEnv('CTXLOCK_HOME', tempDir());
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  it('impact --locks names the repositories whose ctxlock.lock pins a changed unit, by origin or by folder', async () => {
    const { dir: org } = await gitRepo([files, { '.claude/rules/a.md': 'Use pnpm, always.\n' }]);
    git(org, 'remote', 'add', 'origin', 'https://github.com/acme/org.git');
    const D = `sha256:${'c'.repeat(64)}`;
    const lockOf = (repo: string, path: string) =>
      serializeLock({ upstreams: [{ name: 'platform', repo, ref: 'main', commit: 'f'.repeat(40), units: [{ path, id: `rule/${path}`, digest: D, tier: 'reviewed', files: { [path]: D } }] }] });
    const others = tempDir();
    writeTree(others, {
      'payments/ctxlock.lock': lockOf('https://github.com/acme/org', '.claude/rules/a.md'),
      'docs/ctxlock.lock': lockOf(org, '.claude/rules/a.md'),
      'web/ctxlock.lock': lockOf(org, '.claude/rules/b.md'),
      'web/node_modules/x/ctxlock.lock': lockOf(org, '.claude/rules/a.md'),
    });
    git(join(others, 'payments'), 'init', '-q');
    git(join(others, 'payments'), 'remote', 'add', 'origin', 'https://github.com/acme/payments.git');

    const { code, stdout } = await cli('impact', org, '--base', 'HEAD~1', '--locks', others);
    expect(code).toBe(0);
    const docs = realpathSync.native(join(others, 'docs'));
    expect(stdout).toMatch(
      new RegExp(`\nPinned by other repositories:\n  ${escape(docs)}\\s+\\.claude/rules/a\\.md  at sha256:cccccccccccc  from platform\n  https://github\\.com/acme/payments\\.git\\s+\\.claude/rules/a\\.md  at sha256:cccccccccccc  from platform\n`),
    );
    expect(stdout).not.toContain('web');

    // A folder has more than one name: a link to it, or on Windows an 8.3 short name.
    const link = join(tempDir(), 'org-link');
    symlinkSync(realpathSync.native(org), link, 'junction');
    const linked = tempDir();
    writeTree(linked, { 'api/ctxlock.lock': lockOf(link, '.claude/rules/a.md') });
    expect((await cli('impact', org, '--base', 'HEAD~1', '--locks', linked)).stdout).toMatch(/\nPinned by other repositories:\n {2}\S+api\s+\.claude\/rules\/a\.md/);

    const none = await cli('impact', org, '--base', 'HEAD~1', '--locks', join(others, 'web'));
    expect(none.stdout).toContain('\nNo repository under the --locks paths pins what changed.\n');
    expect((await cli('impact', org, '--base', 'HEAD~1')).stdout).not.toContain('--locks');
  });
});

describe('ctxlock sync', { timeout: 120_000 }, () => {
  const SKILL = '---\nname: api\ndescription: Use for API work.\n---\nValidate with zod.\n';
  const ORG = { '.agents/skills/api/SKILL.md': SKILL, '.claude/rules/testing.md': 'Run pnpm test.\n', 'AGENTS.md': 'The org.\n' };
  // A consumer whose ctxlock.yaml names the org by a path relative to itself.
  async function consumer(org: string, units = ['.agents/skills/api', '.claude/rules/testing.md'], files: Record<string, string> = {}) {
    const { dir } = await gitRepo([{ 'AGENTS.md': 'The service.\n', ...files }]);
    const repo = relative(dir, org).split(sep).join('/');
    writeTree(dir, { 'ctxlock.yaml': `version: 1\nupstream:\n  platform:\n    repo: ${repo}\n    units: [${units.join(', ')}]\n` });
    return dir;
  }
  const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8');

  it('brings a skill and a rule in, pins them in ctxlock.lock, fills the skill for Claude Code, and a second sync changes nothing', async () => {
    const { dir: org, shas } = await gitRepo([ORG]);
    const own = '---\nname: own\ndescription: Ours.\n---\nOurs.\n';
    const dir = await consumer(org, undefined, { '.agents/skills/own/SKILL.md': own });
    const cache = tempDir();

    const dry = await cli('sync', dir, '--dry-run', '--cache', cache);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('Added:\n  .agents/skills/api        from platform\n  .claude/rules/testing.md  from platform');
    expect(dry.stdout).toContain('A dry run: nothing was written.');
    expect(existsSync(join(dir, 'ctxlock.lock'))).toBe(false);
    expect(existsSync(join(dir, '.agents/skills/api/SKILL.md'))).toBe(false);

    const synced = await cli('sync', dir, '--cache', cache);
    expect(synced.code).toBe(0);
    expect(synced.stdout).toContain(`Upstreams:\n  platform  main  ${shas[0]!.slice(0, 7)}`);
    expect(synced.stdout).toContain('Filled, so every agent loads it:\n  .claude/skills/api/SKILL.md');
    expect(synced.stdout).not.toContain('dry run');
    expect(read(dir, '.agents/skills/api/SKILL.md')).toBe(SKILL);
    expect(read(dir, '.claude/rules/testing.md')).toBe('Run pnpm test.\n');
    expect(read(dir, '.claude/skills/api/SKILL.md')).toBe(SKILL);
    // A gap sync did not bring in is build's to fill.
    expect(existsSync(join(dir, '.claude/skills/own'))).toBe(false);
    const lock = read(dir, 'ctxlock.lock');
    expect(lock).toContain(`commit: ${shas[0]}`);

    const again = await cli('sync', dir, '--cache', cache);
    expect([again.code, again.stdout]).toEqual([0, `ctxlock sync\n\nUpstreams:\n  platform  main  ${shas[0]!.slice(0, 7)}\n\nNothing changed.\n`]);
    expect(read(dir, 'ctxlock.lock')).toBe(lock);
  });

  it("a unit taken out of units goes with the copy sync's fill made of it, unless that copy was edited", async () => {
    const { dir: org } = await gitRepo([ORG]);
    const dir = await consumer(org);
    const cache = tempDir();
    await cli('sync', dir, '--cache', cache);
    expect(existsSync(join(dir, '.claude/skills/api/SKILL.md'))).toBe(true);

    writeTree(dir, { 'ctxlock.yaml': read(dir, 'ctxlock.yaml').replace('.agents/skills/api, ', '') });
    const dropped = await cli('sync', dir, '--cache', cache);
    expect(dropped.code).toBe(0);
    expect(dropped.stdout).toContain('Removed from the other agents with it:\n  .claude/skills/api/SKILL.md');
    expect(existsSync(join(dir, '.agents/skills/api/SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/api/SKILL.md'))).toBe(false);
    expect(read(dir, '.ctxlock/generated.json')).not.toContain('.claude/skills/api');

    // An edited copy is a person's, so it stays.
    const kept = await consumer(org);
    await cli('sync', kept, '--cache', cache);
    writeTree(kept, { '.claude/skills/api/SKILL.md': `${SKILL}Ours.\n`, 'ctxlock.yaml': read(kept, 'ctxlock.yaml').replace('.agents/skills/api, ', '') });
    expect((await cli('sync', kept, '--cache', cache)).stdout).not.toContain('Removed from the other agents');
    expect(read(kept, '.claude/skills/api/SKILL.md')).toBe(`${SKILL}Ours.\n`);

    // A file made from several sources stays while any of them does.
    const { dir: claudeOnly } = await gitRepo([{ 'CLAUDE.md': 'The service.\n' }]);
    const repo = relative(claudeOnly, org).split(sep).join('/');
    writeTree(claudeOnly, { 'ctxlock.yaml': `version: 1\nupstream:\n  platform:\n    repo: ${repo}\n    units: [.claude/rules/testing.md]\n` });
    expect((await cli('sync', claudeOnly, '--cache', cache)).stdout).toContain('Filled, so every agent loads it:\n  AGENTS.md');
    writeTree(claudeOnly, { 'ctxlock.yaml': `version: 1\nupstream:\n  platform:\n    repo: ${repo}\n    units: []\n` });
    expect((await cli('sync', claudeOnly, '--cache', cache)).code).toBe(0);
    expect(existsSync(join(claudeOnly, 'AGENTS.md'))).toBe(true);
  });

  it('refuses a synced file edited by hand, exits 1 and writes nothing, the lock included', async () => {
    const { dir: org } = await gitRepo([ORG]);
    const dir = await consumer(org);
    const cache = tempDir();
    await cli('sync', dir, '--cache', cache);
    const lock = read(dir, 'ctxlock.lock');
    writeTree(org, { '.agents/skills/api/SKILL.md': `${SKILL}Upstream line.\n` });
    git(org, 'commit', '-qam', 'skill');
    writeTree(dir, { '.claude/rules/testing.md': 'Changed here.\n' });

    const refused = await cli('sync', dir, '--cache', cache);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain('Refused, so nothing was written:\n  .claude/rules/testing.md  edited since the last sync');
    expect(read(dir, '.agents/skills/api/SKILL.md')).toBe(SKILL);
    expect(read(dir, 'ctxlock.lock')).toBe(lock);
    const lint = await cli('lint', dir);
    expect(lint.code).toBe(1);
    expect(lint.stdout).toMatch(/must\s+L16-lock\s+\.claude\/rules\/testing\.md\s+\.claude\/rules\/testing\.md differs from ctxlock\.lock/);

    // A file git ignores is still a person's file.
    const ignoring = await consumer(org, undefined, { '.gitignore': '.claude/rules/\n' });
    writeTree(ignoring, { '.claude/rules/testing.md': 'Ours, ignored.\n' });
    const ignored = await cli('sync', ignoring, '--cache', cache);
    expect(ignored.code).toBe(1);
    expect(ignored.stdout).toContain('.claude/rules/testing.md  a file sync did not write');
    expect(read(ignoring, '.claude/rules/testing.md')).toBe('Ours, ignored.\n');
  });

  it('exits 2 naming a unit the upstream lacks, an unreadable lock, and a folder outside git', async () => {
    const { dir: org } = await gitRepo([ORG]);
    const cache = tempDir();

    const missing = await cli('sync', await consumer(org, ['.claude/rules/nope.md']), '--cache', cache, '--format', 'markdown');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/^upstream platform: \.claude\/rules\/nope\.md is no unit at [0-9a-f]{7}\n$/);
    expect(missing.stdout).toContain('ctxlock could not run: `upstream platform: .claude/rules/nope.md is no unit at');

    const badLock = await consumer(org);
    writeTree(badLock, { 'ctxlock.lock': 'lockfile_version: 2\n' });
    const locked = await cli('sync', badLock, '--cache', cache);
    expect(locked.code).toBe(2);
    expect(locked.stderr).toMatch(/^ctxlock\.lock: /);
    // lint reports the same lock rather than stopping on it.
    const linted = await cli('lint', badLock);
    expect(linted.code).toBe(1);
    expect(linted.stdout).toMatch(/must\s+L16-lock\s+ctxlock\.lock\s+ctxlock\.lock: lockfile_version/);

    const badRecord = await consumer(org);
    writeTree(badRecord, { '.ctxlock/generated.json': 'nope' });
    const record = await cli('sync', badRecord, '--cache', cache);
    expect(record.code).toBe(2);
    expect(record.stderr).toMatch(/^\.ctxlock\/generated\.json is not valid: .*; fix it first/);
    expect(existsSync(join(badRecord, '.agents/skills/api'))).toBe(false);

    const outside = tempDir();
    writeTree(outside, { 'ctxlock.yaml': 'version: 1\n' });
    const notGit = await cli('sync', outside, '--cache', cache);
    expect([notGit.code, notGit.stderr]).toEqual([2, `ctxlock: ${outside} is not in a git repository\n`]);
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

describe('ctxlock report', () => {
  const event = (cwd: string) =>
    `${JSON.stringify({ v: 1, ts: '2026-11-08T10:00:00.000Z', harness: 'claude-code', session: 's1', cwd, event: 'load', file: join(cwd, 'CLAUDE.md'), sha256: null, reason: 'session_start' })}\n`;

  it('names the repository by its origin, else by its folder, and --out writes the file', async () => {
    const { dir } = await gitRepo([{ 'CLAUDE.md': 'Use pnpm.\n' }]);
    const home = tempDir();
    writeTree(home, { 'events/2026-11.jsonl': event(realpathSync.native(dir)) });
    vi.stubEnv('CTXLOCK_HOME', home);

    const bare = await cli('report', dir);
    expect(bare.code).toBe(0);
    expect(JSON.parse(bare.stdout)).toMatchObject({ version: 1, repo: realpathSync.native(dir).split(sep).at(-1), sessions: 1 });

    git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/payments.git');
    const out = join(tempDir(), 'report.json');
    const written = await cli('report', dir, '--out', out);
    expect([written.code, written.stdout]).toEqual([0, `ctxlock report: wrote ${out}\n`]);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    expect(report).toMatchObject({ repo: 'https://github.com/acme/payments.git', sessions: 1, units: [{ id: 'instructions/CLAUDE.md', sessions: 1 }] });
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

describe('ctxlock misses', () => {
  const ts = (second: number) => `2026-11-11T10:00:${String(second).padStart(2, '0')}.000Z`;

  // A repository, the collector's record of one session in it at cwd, and that session's transcript.
  function recorded(cwd: (real: string) => string) {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n', '.claude/rules/api.md': 'API rule.\n' });
    const real = realpathSync.native(dir);
    const top = cwd(real);
    const event = (second: number, o: object) => JSON.stringify({ v: 1, ts: ts(second), harness: 'claude-code', session: 's1', cwd: top, ...o });
    const home = tempDir();
    writeTree(home, {
      'events/2026-11.jsonl': [
        event(0, { event: 'session_start', source: 'startup' }),
        event(0, { event: 'load', file: join(top, 'CLAUDE.md'), sha256: null, reason: 'session_start' }),
        event(3, { event: 'load', file: join(top, '.claude', 'rules', 'api.md'), sha256: null, reason: 'session_start' }),
        '',
      ].join('\n'),
    });
    vi.stubEnv('CTXLOCK_HOME', home);
    const config = tempDir();
    const line = (second: number, o: object) => JSON.stringify({ parentUuid: null, isSidechain: false, timestamp: ts(second), sessionId: 's1', cwd: top, ...o });
    writeTree(config, {
      'projects/F--repo/s1.jsonl': [
        line(1, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'add the endpoint' }] } }),
        line(2, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Adding it.' }] } }),
        line(4, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
        line(5, { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'no, the v2 endpoint' }] } }),
        '',
      ].join('\n'),
    });
    vi.stubEnv('CLAUDE_CONFIG_DIR', config);
    return dir;
  }

  it("misses joins a recorded session's transcript to the repository's units", async () => {
    const dir = recorded((real) => real);

    const { code, stdout } = await cli('misses', dir, '--format', 'json', '--excerpts');
    expect(code).toBe(0);
    const m = JSON.parse(stdout);
    expect(m).toMatchObject({ sessions: 1, withTranscript: 1, withSignal: 1, signals: { interrupted: 1, correction: 1 }, minSessions: 3 });
    expect(m.units.map((u: { id: string; sessions: number; kinds: object }) => [u.id, u.sessions, u.kinds])).toEqual([
      ['rule/.claude/rules/api.md', 1, { interrupted: 1, correction: 1 }],
      ['instructions/CLAUDE.md', 1, { interrupted: 1, correction: 1 }],
    ]);
    expect(m.found.map((s: { words?: string }) => s.words)).toEqual([undefined, 'no, the v2 endpoint']);
    expect((await cli('misses', dir, '--min-sessions', '1')).stdout).toContain('Routed at 1 session or more: 2 units.');
  });

  it('a session recorded through a junction is joined', async () => {
    const dir = recorded((real) => {
      const link = join(tempDir(), 'link');
      symlinkSync(real, link, 'junction');
      return link;
    });

    expect(JSON.parse((await cli('misses', dir, '--format', 'json')).stdout)).toMatchObject({ sessions: 1, withTranscript: 1, withSignal: 1 });
  });

  it.runIf(process.platform === 'win32')('a session recorded with a lowercase drive is joined', async () => {
    const dir = recorded((real) => real[0]!.toLowerCase() + real.slice(1));

    expect(JSON.parse((await cli('misses', dir, '--format', 'json')).stdout).units).toHaveLength(2);
  });

  it('no recorded sessions is exit 0 with the collector pointer', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n' });

    const { code, stdout } = await cli('misses', dir);
    expect(code).toBe(0);
    expect(stdout).toContain('ctxlock misses · no Claude Code sessions recorded for this repository');
  });

  it("--drafts writes one file per routed unit, rewrites its own drafts, and leaves a person's file of the same name", async () => {
    const dir = recorded((real) => real);
    const drafts = join(tempDir(), 'drafts');
    const rule = join(drafts, draftName('rule/.claude/rules/api.md'));
    const claude = join(drafts, draftName('instructions/CLAUDE.md'));

    const first = await cli('misses', dir, '--min-sessions', '1', '--drafts', drafts);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`Drafts written:\n  ${rule}\n  ${claude}\n`);
    expect(readFileSync(rule, 'utf8')).toMatch(/^<!-- ctxlock:miss rule\/\.claude\/rules\/api\.md \S+ -->\n/);
    expect(readFileSync(rule, 'utf8')).not.toContain('v2 endpoint');

    writeFileSync(claude, 'My own notes.\n');
    const again = await cli('misses', dir, '--min-sessions', '1', '--drafts', drafts, '--excerpts');
    expect(again.stdout).toContain(`Drafts written:\n  ${rule}\n`);
    expect(again.stdout).toContain(`Left as it is, not a ctxlock draft:\n  ${claude}\n`);
    expect(readFileSync(claude, 'utf8')).toBe('My own notes.\n');
    expect(readFileSync(rule, 'utf8')).toContain('no, the v2 endpoint');

    // An owner's note added to a draft survives the next run.
    const edited = readFileSync(rule, 'utf8').replace('These are signals', 'Sent to @api-team on 2026-11-12. These are signals');
    writeFileSync(rule, edited);
    const third = await cli('misses', dir, '--min-sessions', '1', '--drafts', drafts);
    expect(third.stdout).toContain(`Left as it is, edited since ctxlock wrote it:\n  ${rule}\n`);
    expect(readFileSync(rule, 'utf8')).toBe(edited);

    expect((await cli('misses', dir, '--drafts', drafts)).stdout).toContain('No unit is routed, so no draft was written.');
  });

  it('a bad --since is exit 2', async () => {
    const dir = tempDir();
    for (const since of ['yesterday', '2026-13-01', '2026-11-1']) expect((await cli('misses', dir, '--since', since)).code, since).toBe(2);
    for (const since of ['yesterday', '2026-13-01', '2026-00-10']) expect((await cli('misses', dir, '--since', since)).stderr, since).toContain('expected a date as YYYY-MM-DD');
    expect((await cli('misses', dir, '--since', '2026-11-01')).code).toBe(0);
  });
});
