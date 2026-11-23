import { describe, expect, it } from 'vitest';
import { scanRepo } from '../src/scan.js';
import { memReader } from './helpers/mem-reader.js';

// One of every file type another agent reads, with an @import of one from CLAUDE.md. Extend it with each new path.
export const OTHER_AGENTS: Record<string, string> = {
  '.github/copilot-instructions.md': 'Use pnpm.\n',
  '.github/instructions/api.instructions.md': '---\napplyTo: "src/**"\n---\nUse zod.\n',
  '.cursor/rules/api.mdc': '---\nalwaysApply: true\n---\nUse zod.\n',
  '.cursorrules': 'Use pnpm.\n',
  '.cursor/skills/x/SKILL.md': '---\nname: x\ndescription: d\n---\nbody\n',
  'GEMINI.md': 'Use pnpm.\n',
  'pkg/GEMINI.md': 'Use pnpm here.\n',
  '.agents/rules/style.md': 'Tabs.\n',
  '.devin/rules/style.md': 'Tabs.\n',
  '.windsurfrules': 'Tabs.\n',
  '.kiro/steering/style.md': 'Tabs.\n',
  '.clinerules/style.md': 'Tabs.\n',
  '.cline/skills/y/SKILL.md': '---\nname: y\ndescription: d\n---\nbody\n',
  '.opencode/skills/z/SKILL.md': '---\nname: z\ndescription: d\n---\nbody\n',
  '.junie/guidelines.md': 'Tabs.\n',
  'AGENT.md': 'Use pnpm.\n',
  'sub/AGENTS.local.md': 'Local.\n',
  '.github/skills/w/SKILL.md': '---\nname: w\ndescription: d\n---\nbody\n',
  '.github/workflows/copilot-setup-steps.yml': 'jobs:\n  copilot-setup-steps:\n    runs-on: ubuntu-latest\n',
  '.github/hooks/guard.json': '{"version": 1, "hooks": {}}',
  '.vscode/mcp.json': '{"servers": {}}',
  '.cursor/mcp.json': '{"mcpServers": {}}',
  '.gemini/settings.json': '{}',
  '.agents/mcp_config.json': '{"mcpServers": {}}',
  '.devin/hooks.v1.json': '{}',
  '.kiro/settings/mcp.json': '{"mcpServers": {}}',
  '.clinerules/hooks/PreToolUse': '#!/bin/sh\n',
  'opencode.json': '{}',
  '.opencode/plugins/audit.ts': 'export {}\n',
  '.junie/mcp/mcp.json': '{"mcpServers": {}}',
};

describe('scanRepo', () => {
  it("other agents' files change nothing Claude Code or Codex are predicted to load", async () => {
    const modelled = { 'AGENTS.md': 'Use pnpm.\n', 'CLAUDE.md': '@AGENTS.md\n', '.claude/skills/r/SKILL.md': '---\nname: r\ndescription: d\n---\nbody\n', '.agents/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\nbody\n' };
    const scan = (files: Record<string, string>) => scanRepo(memReader(files), { today: '2026-11-23' });

    const without = await scan(modelled);
    const withOthers = await scan({ ...modelled, ...OTHER_AGENTS });

    expect(withOthers.contexts).toEqual(without.contexts);
    expect(withOthers.budget).toEqual(without.budget);
    expect(withOthers.units.length).toBeGreaterThan(without.units.length + Object.keys(OTHER_AGENTS).length - 1);
  });

  it('a CLAUDE.md that imports GEMINI.md loads it as a plain file, as in 0.1.0, not as the Gemini unit', async () => {
    const result = await scanRepo(memReader({ 'CLAUDE.md': '@GEMINI.md\n', 'GEMINI.md': 'Use pnpm.\n' }), { today: '2026-11-23' });

    const claude = result.contexts.find((c) => c.harness === 'claude-code')!;
    expect(claude.entries.map((e) => [e.unitId, e.reason])).toEqual([
      ['instructions/CLAUDE.md', 'ancestor'],
      ['file/GEMINI.md', 'import:CLAUDE.md'],
    ]);
    expect(result.units.map((u) => [u.id, u.family])).toContainEqual(['instructions/GEMINI.md', 'gemini']);
  });

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

  it('a unit the lock records as knowledge or a metric is that kind, though nothing else declares it', async () => {
    const lock = [
      'lockfile_version: 1',
      'upstreams:',
      '  - name: org',
      '    repo: ../org',
      '    ref: main',
      `    commit: ${'a'.repeat(40)}`,
      '    units:',
      '      - { path: org/nrr.md, id: knowledge/org/nrr.md, digest: "sha256:x", tier: reviewed, files: {} }',
      '      - { path: org/revenue.yaml, id: metric/org/revenue.yaml, digest: "sha256:x", tier: reviewed, files: {} }',
      '      - { path: .claude/rules/r.md, id: rule/.claude/rules/r.md, digest: "sha256:x", tier: reviewed, files: {} }',
      '',
    ].join('\n');
    const files = { 'ctxlock.lock': lock, 'org/nrr.md': '---\ntype: Metric\n---\n', 'org/revenue.yaml': 'name: revenue\n', 'org/other.md': '---\ntype: Metric\n---\n', '.claude/rules/r.md': 'r' };
    const result = await scanRepo(memReader(files), { today: '2026-11-21' });

    expect(result.units.map((u) => u.id)).toEqual(['rule/.claude/rules/r.md', 'knowledge/org/nrr.md', 'metric/org/revenue.yaml']);
  });

  it('a concept past its stale_after is flagged by L9, and ctxlock.yaml wins when both are set', async () => {
    const concept = '---\ntype: Reference\nstale_after: 2026-12-31T00:00:00Z\nverified: { by: human:a, at: 2026-06-25T09:00:00Z }\n---\n# Body\n';
    const files = (units = '') => ({ 'ctxlock.yaml': `version: 1\nknowledge: [kb]\n${units}`, 'kb/a.md': concept });
    const rules = async (f: Record<string, string>, today: string) => (await scanRepo(memReader(f), { today })).findings.map((x) => x.rule);

    const scan = await scanRepo(memReader(files()), { today: '2026-12-31' });
    expect(scan.registry.units['kb/a.md']).toEqual({ verifiedAt: '2026-06-25', staleAfter: '2026-12-30' });
    expect(scan.findings.map((x) => x.rule)).toContain('L9-stale');
    expect(await rules(files(), '2026-12-30')).not.toContain('L9-stale');

    const later = files('units:\n  kb/a.md:\n    owner: "@finance"\n    stale-after: 2027-01-31\n');
    const own = await scanRepo(memReader(later), { today: '2026-12-31' });
    expect(own.registry.units['kb/a.md']).toEqual({ owner: '@finance', verifiedAt: '2026-06-25', staleAfter: '2027-01-31' });
    expect(own.findings.map((x) => x.rule)).not.toContain('L9-stale');
    expect(own.findings.filter((x) => x.rule === 'L17-trust-differs').map((x) => [x.severity, x.path, x.message])).toEqual([
      ['should', 'kb/a.md', "ctxlock.yaml says stale-after 2027-01-31, the file's stale_after gives 2026-12-30; ctxlock.yaml wins"],
    ]);
    // The same date in both places is no disagreement.
    expect(await rules(files('units:\n  kb/a.md:\n    verified-at: 2026-06-25\n'), '2026-11-21')).not.toContain('L17-trust-differs');
    expect(await rules(files('units:\n  kb/a.md:\n    verified-at: 2026-06-01\n'), '2026-11-21')).toContain('L17-trust-differs');
    // Only an OKF concept's frontmatter is OKF.
    const rule = await scanRepo(memReader({ '.claude/rules/r.md': concept }), { today: '2026-12-31' });
    expect(rule.registry.units).toEqual({});
  });

  it('ctxlock.yaml declares bundles and models for discovery', async () => {
    const files = { 'ctxlock.yaml': 'version: 1\nknowledge: [kb]\nmetrics: [m]\n', 'kb/a.md': '---\ntype: Reference\n---\n', 'm/x.yaml': 'name: x\n' };
    expect((await scanRepo(memReader(files), { today: '2026-11-21' })).units.map((u) => u.id)).toEqual(['knowledge/kb/a.md', 'metric/m/x.yaml']);
  });
});
