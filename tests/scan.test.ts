import { describe, expect, it } from 'vitest';
import { scanRepo } from '../src/scan.js';
import { memReader } from './helpers/mem-reader.js';

describe('scanRepo', () => {
  it('discovers, resolves, budgets and lints, with discovery problems among the findings', async () => {
    const result = await scanRepo(memReader({ 'AGENTS.md': 'Use pnpm.\n', 'CLAUDE.md': Buffer.from([0xff, 0xfe]) }), { today: '2026-11-05' });

    expect(result.units.map((u) => u.id)).toEqual(['instructions/AGENTS.md', 'instructions/CLAUDE.md']);
    expect(result.contexts.map((c) => `${c.harness}@${c.site}`)).toEqual(['claude-code@', 'codex@']);
    expect(result.budget).toHaveLength(2);
    expect(result.findings.map((f) => f.rule)).toContain('L0-encoding');
    expect(result.findings.map((f) => f.rule)).toContain('L13-agents-md-shadowed');
  });

  it('runs agnix only when asked, through the given runner', async () => {
    const files = { 'AGENTS.md': 'Use pnpm.\n' };
    const runs: string[] = [];
    const runAgnix = async (root: string) => {
      runs.push(root);
      return JSON.stringify({ diagnostics: [{ level: 'error', rule: 'XP-1', file: 'AGENTS.md', line: 1, column: 1, message: 'm' }] });
    };

    expect((await scanRepo(memReader(files), { runAgnix, today: '2026-11-05' })).findings.map((f) => f.rule)).not.toContain('agnix:XP-1');
    expect(runs).toEqual([]);
    expect((await scanRepo(memReader(files), { agnix: true, runAgnix, today: '2026-11-05' })).findings.map((f) => f.rule)).toContain('agnix:XP-1');
    expect(runs).toEqual(['/mem']);
  });

  it('today defaults to the local date', async () => {
    const now = new Date();
    const day = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
    };
    const files = (date: string) => ({ 'AGENTS.md': 'a', 'ctxlock.yaml': `version: 1\nunits:\n  AGENTS.md:\n    stale-after: ${date}\n` });

    expect((await scanRepo(memReader(files(day(0))))).findings.map((f) => f.rule)).not.toContain('L9-stale');
    expect((await scanRepo(memReader(files(day(-1))))).findings.map((f) => f.rule)).toContain('L9-stale');
  });
});
