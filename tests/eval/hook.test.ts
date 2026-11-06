import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HOOK_SCRIPT } from '../../src/eval/hook-script.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

function hook(event: string, payload: Record<string, unknown>, root = join(tempDir(), 'run')) {
  const dir = tempDir();
  const script = join(dir, 'hook.mjs');
  const log = join(dir, 'events.jsonl');
  writeFileSync(script, HOOK_SCRIPT);
  writeFileSync(log, '');
  const out = spawnSync(process.execPath, [script, event, log, root], {
    input: JSON.stringify({ cwd: root, ...payload }),
    encoding: 'utf8',
  });
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { root, status: out.status, stdout: out.stdout, stderr: out.stderr, logged: lines.map((l) => JSON.parse(l)) };
}

const decision = (stdout: string) => JSON.parse(stdout).hookSpecificOutput;

describe('the run-scoped hook', () => {
  it.each(['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('denies %s and logs it', (tool) => {
    const r = hook('PreToolUse', { tool_name: tool, tool_input: { command: 'pnpm add zod', file_path: 'x.txt' } });
    expect(r.status).toBe(0);
    expect(decision(r.stdout)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(decision(r.stdout).permissionDecisionReason).toMatch(/^observe-and-deny/);
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0].payload.tool_name).toBe(tool);
  });

  it('lets reads inside the run folder through, silently', () => {
    const inside = [
      { tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: '/foo/' } },
      { tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '**/*.ts', path: 'src' } },
    ];
    for (const payload of inside) {
      const r = hook('PreToolUse', payload);
      expect(r.stdout, JSON.stringify(payload)).toBe('');
      expect(r.logged).toEqual([]);
    }
    const root = join(tempDir(), 'run');
    expect(hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'a.ts') } }, root).stdout).toBe('');
  });

  it('denies and logs reads that leave the run folder', () => {
    const outside = [
      { tool_name: 'Read', tool_input: { file_path: '../secret.txt' } },
      { tool_name: 'Read', tool_input: { file_path: tempDir() } },
      { tool_name: 'Glob', tool_input: { pattern: '/etc/**' } },
      { tool_name: 'Glob', tool_input: { pattern: '../*' } },
      { tool_name: 'Glob', tool_input: { pattern: 'C:/Users/**' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', path: '..' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '../**' } },
    ];
    for (const payload of outside) {
      const r = hook('PreToolUse', payload);
      expect(decision(r.stdout).permissionDecisionReason, JSON.stringify(payload)).toMatch(/outside the run folder/);
      expect(r.logged[0].outside).toBe(true);
    }
  });

  it.runIf(process.platform === 'win32')('compares paths without case on Windows', () => {
    const root = join(tempDir(), 'run');
    expect(hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: join(root.toUpperCase(), 'a.ts') } }, root).stdout).toBe('');
  });

  it.each(['InstructionsLoaded', 'PostToolUse'])('logs %s and prints nothing', (event) => {
    const r = hook(event, { file_path: '/run/CLAUDE.md', load_reason: 'session_start' });
    expect(r.stdout).toBe('');
    expect(r.logged).toEqual([expect.objectContaining({ event, payload: expect.objectContaining({ file_path: '/run/CLAUDE.md' }) })]);
  });
});
