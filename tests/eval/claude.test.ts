import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeNotFound, PROBE_TOOLS, claudeArgs, claudeSettings, claudeVersion, parseStream, relativeTo, runClaude } from '../../src/eval/claude.js';
import { cleanup, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const FAKE = resolve('tests/helpers/fake-claude.mjs');
let argvLog: string;

beforeEach(() => {
  argvLog = join(tempDir(), 'argv.jsonl');
  process.env.FAKE_CLAUDE_ARGV_LOG = argvLog;
});

function useScenario(s: Record<string, unknown>) {
  const file = join(tempDir(), 'scenario.json');
  writeFileSync(file, JSON.stringify(s));
  process.env.FAKE_CLAUDE_SCENARIO = file;
}

function arm(files: Record<string, string> = {}) {
  const dir = join(tempDir(), 'arm');
  mkdirSync(dir, { recursive: true });
  writeTree(dir, files);
  return dir;
}

const run = (dir: string, extra: { timeoutMs?: number; claude?: string[] } = {}) =>
  runClaude({ dir, scratch: join(tempDir(), 'scratch'), prompt: 'Add zod as a dependency.', model: 'sonnet', claude: [FAKE], ...extra });

describe('claudeArgs and claudeSettings', () => {
  it('pass the isolation flags from spike S1, exactly', () => {
    expect(claudeArgs({ model: 'sonnet', tools: PROBE_TOOLS }, '/s/settings.json')).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--settings', '/s/settings.json',
      '--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill',
      '--no-session-persistence', '--model', 'sonnet',
    ]);
    expect(claudeArgs({ model: 'sonnet', tools: [] }, 's').slice(9, 11)).toEqual(['--tools', '']);
  });

  it('hook loads, skills, and every tool that acts or reads, and exclude what is above the run folder', () => {
    const settings = claudeSettings((event) => `hook ${event}`, ['/a/CLAUDE.md']) as {
      claudeMdExcludes: string[];
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
    };
    expect(settings.claudeMdExcludes).toEqual(['/a/CLAUDE.md']);
    // A skill's inline shell runs when the skill loads, not through a hooked tool call.
    expect((settings as unknown as { disableSkillShellExecution: boolean }).disableSkillShellExecution).toBe(true);
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Read|Glob|Grep', hooks: [{ type: 'command', command: 'hook PreToolUse' }] }]);
    expect(settings.hooks.PostToolUse).toEqual([{ matcher: 'Skill', hooks: [{ type: 'command', command: 'hook PostToolUse' }] }]);
    expect(settings.hooks.InstructionsLoaded).toEqual([{ hooks: [{ type: 'command', command: 'hook InstructionsLoaded' }] }]);
  });
});

describe('parseStream', () => {
  it('reads a recorded Claude Code 2.1.292 stream', () => {
    const facts = parseStream(readFileSync('tests/fixtures/eval/stream-pnpm.jsonl', 'utf8'), '/run');
    expect(facts).toMatchObject({
      model: 'claude-sonnet-5-5',
      version: '2.1.292',
      turns: 2,
      commands: ['pnpm add lodash'],
      inputTokens: 4 + 7084 + 60931,
      outputTokens: 255,
      costUsd: 0.0440392,
      utilization: 0.57,
      error: null,
    });
    expect(facts.listedSkills).toContain('simplify');
  });
});

describe('runClaude', () => {
  it('denies every intended action, records what loaded, and leaves the copy unchanged', async () => {
    useScenario({
      skills: ['release'],
      loads: [{ file: 'CLAUDE.md', reason: 'session_start' }, { file: 'AGENTS.md', reason: 'include', parent: 'CLAUDE.md' }],
      behaviours: [{ calls: [
        { tool: 'Bash', input: { command: 'pnpm add zod' } },
        { tool: 'Write', input: { file_path: 'x.txt', content: 'x' } },
        { tool: 'Skill', input: { skill: 'release' } },
      ] }],
      text: 'done',
    });
    const dir = arm({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'Use pnpm.\n' });

    const t = await run(dir);

    expect(t).toMatchObject({ commands: ['pnpm add zod'], edits: ['x.txt'], skills: ['release'], listedSkills: ['release'], denied: 2, outsideReads: 0, text: 'done', error: null });
    expect([...t.loads].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'AGENTS.md', reason: 'include', parent: 'CLAUDE.md' },
      { path: 'CLAUDE.md', reason: 'session_start' },
    ]);
    expect(existsSync(join(dir, 'x.txt'))).toBe(false);
  });

  it('sends the prompt on stdin, so a long one fits where a command line stops at 32,767 characters (Windows)', async () => {
    const long = 'x'.repeat(40_000);
    useScenario({ behaviours: [{ when: { promptContains: long }, calls: [{ tool: 'Bash', input: { command: 'saw the whole prompt' } }] }] });

    const t = await runClaude({ dir: arm(), scratch: join(tempDir(), 'scratch'), prompt: `Draft probes. ${long}`, model: 'sonnet', claude: [FAKE] });

    expect(t.error).toBeNull();
    expect(t.commands).toEqual(['saw the whole prompt']);
    const seen = JSON.parse(readFileSync(argvLog, 'utf8').trim()) as { argv: string[]; prompt: string };
    expect(seen.argv.join(' ')).not.toContain('xxxx');
    expect(seen.prompt).toBe(`Draft probes. ${long}`);
  });

  it('makes a run an error when a tool call reached Claude Code without passing the run hook', async () => {
    useScenario({ behaviours: [{ calls: [{ tool: 'Bash', input: { command: 'ls' } }, { tool: 'Bash', input: { command: 'echo unhooked' }, unhooked: true }] }] });

    const t = await run(arm());

    expect(t.unhooked).toBe(1);
    expect(t.error).toBe('1 tool call reached Claude Code without passing the run hook');

    // An edit counts too, and a denied read outside the copy does not stand in for a missing call.
    useScenario({ behaviours: [{ calls: [{ tool: 'Read', input: { file_path: '../outside.txt' } }, { tool: 'Write', input: { file_path: 'x.txt', content: 'x' }, unhooked: true }] }] });
    expect((await run(arm())).unhooked).toBe(1);
  });

  it('counts a read outside the copy', async () => {
    useScenario({ behaviours: [{ calls: [{ tool: 'Read', input: { file_path: '../outside.txt' } }, { tool: 'Read', input: { file_path: 'inside.txt' } }] }] });

    expect((await run(arm())).outsideReads).toBe(1);
  });

  it('turns failures into an error, never a throw', async () => {
    useScenario({ exit: 1, stderr: 'Invalid API key · Please run /login\nsecond line' });
    expect((await run(arm())).error).toBe('claude exited 1: Invalid API key · Please run /login');

    useScenario({ apiErrorStatus: 401 });
    expect((await run(arm())).error).toBe('error_during_execution (API status 401)');

    useScenario({ sleepMs: 5000 });
    expect((await run(arm(), { timeoutMs: 500 })).error).toBe('timed out after 500 ms');

    useScenario({ noResult: true });
    expect((await run(arm())).error).toBe('Claude Code ended without a result');

    useScenario({ floodMiB: 70 });
    expect((await run(arm())).error).toMatch(/^claude failed: .*maxBuffer/);
  });

  it('throws ClaudeNotFound, naming --claude, when there is no Claude Code to run', async () => {
    useScenario({});
    const failure = run(arm(), { claude: ['ctxlock-no-such-claude'] });
    await expect(failure).rejects.toBeInstanceOf(ClaudeNotFound);
    await expect(failure).rejects.toThrow(/--claude/);
  });

  it('switches off non-essential traffic for the run', async () => {
    useScenario({});
    await run(arm());
    const line = JSON.parse(readFileSync(argvLog, 'utf8').trim());
    expect(line.nonessential).toBe(true);
  });
});

describe('claudeVersion', () => {
  it('reads the version Claude Code reports', async () => {
    useScenario({ version: '2.1.292' });
    expect(await claudeVersion([FAKE])).toBe('2.1.292');
  });
});

describe('relativeTo', () => {
  it('relativises Windows and POSIX paths on any OS, and rejects paths outside', () => {
    expect(relativeTo('F:\\r\\run-1', 'f:\\R\\run-1\\packages\\api\\CLAUDE.md')).toBe('packages/api/CLAUDE.md');
    expect(relativeTo('/tmp/run', '/tmp/run/a.md')).toBe('a.md');
    expect(relativeTo('/tmp/run', '/tmp/other/a.md')).toBeNull();
    expect(relativeTo('/tmp/run', '/tmp/run-2/a.md')).toBeNull();
  });
});
