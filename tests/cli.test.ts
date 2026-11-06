import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { cleanup, gitRepo, tempDir, writeTree } from './helpers/repo.js';

afterAll(cleanup);

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
