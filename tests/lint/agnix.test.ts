import { describe, expect, it } from 'vitest';
import { agnixFindings } from '../../src/lint/agnix.js';

describe('agnixFindings', () => {
  it('agnix error maps to should and warning to info, and a failing runner gives agnix:unavailable', async () => {
    const output = JSON.stringify({
      diagnostics: [
        { level: 'error', rule: 'AS-004', file: '.claude/skills/x/SKILL.md', line: 2, column: 1, message: 'name must be lowercase' },
        { level: 'warning', rule: 'CC-MEM-005', file: 'CLAUDE.md', line: 10, column: 3, message: 'generic instruction' },
        { level: 'info', rule: 'XP-001', file: 'AGENTS.md', line: 1, column: 1, message: 'note' },
      ],
    });

    expect(await agnixFindings('/repo', async () => output)).toEqual([
      { rule: 'agnix:AS-004', severity: 'should', message: 'name must be lowercase', path: '.claude/skills/x/SKILL.md', line: 2, column: 1 },
      { rule: 'agnix:CC-MEM-005', severity: 'info', message: 'generic instruction', path: 'CLAUDE.md', line: 10, column: 3 },
      { rule: 'agnix:XP-001', severity: 'info', message: 'note', path: 'AGENTS.md', line: 1, column: 1 },
    ]);
    expect(
      await agnixFindings('/repo', async () => {
        throw new Error('npx: command not found');
      }),
    ).toEqual([{ rule: 'agnix:unavailable', severity: 'info', message: 'agnix could not run: npx: command not found' }]);
  });

  it('output that is not agnix JSON gives agnix:unavailable', async () => {
    expect(await agnixFindings('/repo', async () => 'Error: something broke')).toEqual([
      { rule: 'agnix:unavailable', severity: 'info', message: expect.stringMatching(/^agnix could not run: output is not JSON: /) },
    ]);
    expect(await agnixFindings('/repo', async () => '{"results": []}')).toEqual([
      { rule: 'agnix:unavailable', severity: 'info', message: 'agnix could not run: output has no diagnostics list' },
    ]);
  });

  it('absolute file paths are made relative to the root, with forward slashes', async () => {
    const root = process.platform === 'win32' ? 'C:\\repo' : '/repo';
    const file = process.platform === 'win32' ? 'C:\\repo\\.claude\\rules\\a.md' : '/repo/.claude/rules/a.md';
    const output = JSON.stringify({ diagnostics: [{ level: 'warning', rule: 'R', file, line: 1, column: 1, message: 'm' }] });

    expect((await agnixFindings(root, async () => output))[0]?.path).toBe('.claude/rules/a.md');
  });
});
