import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lfDigest } from '../../src/units/digest.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

const SCRIPT = resolve('plugin/collect.mjs');

function collect(input: string, home = tempDir()) {
  const out = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: { ...process.env, CTXLOCK_HOME: home } });
  const folder = join(home, 'events');
  const files = existsSync(folder) ? readdirSync(folder) : [];
  const text = files.map((f) => readFileSync(join(folder, f), 'utf8')).join('');
  return { status: out.status, stdout: out.stdout, files, text, lines: text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

// Every field S5 saw on each payload.
const common = (cwd: string) => ({
  session_id: 's-1',
  transcript_path: join(cwd, 'transcript.jsonl'),
  cwd,
  scratchpad_dir: join(cwd, 'scratch'),
  prompt_id: 'p-1',
  effort: { level: 'medium' },
});

describe('the collector', () => {
  it('records an InstructionsLoaded as a load: path, LF digest, reason and trigger, and nothing else', () => {
    const repo = tempDir();
    const file = join(repo, 'CLAUDE.md');
    writeFileSync(file, 'Run tests.\r\nUse pnpm.\r\n');
    const r = collect(
      JSON.stringify({
        ...common(repo),
        hook_event_name: 'InstructionsLoaded',
        file_path: file,
        memory_type: 'Project',
        load_reason: 'nested_traversal',
        trigger_file_path: join(repo, 'a.ts'),
      }),
    );

    expect(r.lines).toHaveLength(1);
    const [line] = r.lines;
    expect(Object.keys(line)).toEqual(['v', 'ts', 'harness', 'session', 'cwd', 'event', 'file', 'sha256', 'reason', 'trigger']);
    expect(line).toMatchObject({ v: 1, harness: 'claude-code', session: 's-1', cwd: repo, event: 'load', file, reason: 'nested_traversal', trigger: join(repo, 'a.ts') });
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(line.sha256).toBe(lfDigest(readFileSync(file)));
    expect(line.sha256).toBe(lfDigest(Buffer.from('Run tests.\nUse pnpm.\n')));
  });

  it('records the importing file of an include as its parent', () => {
    const repo = tempDir();
    writeFileSync(join(repo, 'AGENTS.md'), 'x\n');
    const r = collect(
      JSON.stringify({ ...common(repo), hook_event_name: 'InstructionsLoaded', file_path: join(repo, 'AGENTS.md'), load_reason: 'include', parent_file_path: join(repo, 'CLAUDE.md') }),
    );
    expect(Object.keys(r.lines[0])).toEqual(['v', 'ts', 'harness', 'session', 'cwd', 'event', 'file', 'sha256', 'reason', 'parent']);
    expect(r.lines[0].parent).toBe(join(repo, 'CLAUDE.md'));
  });

  it('records a Skill call by name only', () => {
    const repo = tempDir();
    const r = collect(
      JSON.stringify({
        ...common(repo),
        hook_event_name: 'PostToolUse',
        tool_name: 'Skill',
        tool_input: { skill: 'release', args: 'secret-args' },
        tool_response: { success: true, commandName: 'release', output: 'secret-output' },
        tool_use_id: 'toolu_1',
      }),
    );
    expect(r.lines).toEqual([{ v: 1, ts: expect.any(String), harness: 'claude-code', session: 's-1', cwd: repo, event: 'skill', skill: 'release' }]);
    expect(r.text).not.toMatch(/secret/);
  });

  it('records a session start with its source', () => {
    const repo = tempDir();
    const r = collect(JSON.stringify({ ...common(repo), hook_event_name: 'SessionStart', source: 'startup' }));
    expect(r.lines).toEqual([{ v: 1, ts: expect.any(String), harness: 'claude-code', session: 's-1', cwd: repo, event: 'session_start', source: 'startup' }]);
  });

  it('gives a file it cannot read a null digest', () => {
    const repo = tempDir();
    const r = collect(JSON.stringify({ ...common(repo), hook_event_name: 'InstructionsLoaded', file_path: join(repo, 'gone.md'), load_reason: 'session_start' }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].sha256).toBeNull();
  });

  it('files each event under the month it happened', () => {
    const repo = tempDir();
    const r = collect(JSON.stringify({ ...common(repo), hook_event_name: 'SessionStart', source: 'resume' }));
    expect(r.files).toEqual([`${r.lines[0].ts.slice(0, 7)}.jsonl`]);
  });

  it('writes nothing to stdout and exits 0, whatever it is given', () => {
    const repo = tempDir();
    const valid = collect(JSON.stringify({ ...common(repo), hook_event_name: 'SessionStart', source: 'startup' }));
    expect([valid.status, valid.stdout, valid.lines.length]).toEqual([0, '', 1]);

    // A parse error quotes the input it failed on, and a Skill call's input can hold content.
    const garbled = collect('secret-output {"session_id": "s-1"');
    expect([garbled.status, garbled.stdout]).toEqual([0, '']);
    expect(garbled.lines).toEqual([{ v: 1, ts: expect.any(String), event: 'error', message: expect.any(String) }]);
    expect(garbled.text).not.toMatch(/secret/);

    const other = collect(JSON.stringify({ ...common(repo), hook_event_name: 'Stop' }));
    expect([other.status, other.stdout, other.files]).toEqual([0, '', []]);

    const blocked = join(tempDir(), 'a-file');
    writeFileSync(blocked, '');
    const unwritable = collect(JSON.stringify({ ...common(repo), hook_event_name: 'SessionStart', source: 'startup' }), blocked);
    expect([unwritable.status, unwritable.stdout]).toEqual([0, '']);
  });

  it("the plugin's hooks run collect.mjs on SessionStart, InstructionsLoaded and Skill calls", () => {
    const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const hooks = json('plugin/hooks/hooks.json').hooks;
    const run = { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/collect.mjs"', timeout: 10 };

    expect(Object.keys(hooks).sort()).toEqual(['InstructionsLoaded', 'PostToolUse', 'SessionStart']);
    expect(hooks.SessionStart).toEqual([{ hooks: [run] }]);
    expect(hooks.InstructionsLoaded).toEqual([{ hooks: [run] }]);
    expect(hooks.PostToolUse).toEqual([{ matcher: 'Skill', hooks: [run] }]);
    expect(json('plugin/.claude-plugin/plugin.json').name).toBe('ctxlock');
    expect(json('.claude-plugin/marketplace.json').plugins).toEqual([expect.objectContaining({ name: 'ctxlock', source: './plugin' })]);
  });
});
