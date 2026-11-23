import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../src/check.js';
import { renderCheck } from '../../src/report/check.js';

const result = (over: Partial<CheckResult> = {}): CheckResult => ({ target: 'https://example.com/acme/skills', read: 'HEAD @ 3f2a9c1', runs: [], must: [], worthALook: [], ...over });

describe('renderCheck', () => {
  it('lists what runs, what must be fixed and what is worth a look, then the verdict', () => {
    const text = renderCheck(
      result({
        runs: [
          { agent: 'Claude Code', file: '.claude/settings.json', message: 'SessionStart hook runs "./setup.sh"' },
          { agent: 'Cursor', file: '.cursor/mcp.json', message: 'MCP server db runs "npx -y db-mcp"' },
        ],
        must: [{ rule: 'L1-hidden-unicode', severity: 'must', path: '.cursor/rules/api.mdc', line: 4, message: 'hidden character U+200B ZERO WIDTH SPACE at 4:12' }],
        worthALook: [{ rule: 'L2-risky-instruction', severity: 'should', path: 'AGENTS.md', line: 12, message: 'pipes a download into a shell at 12:1' }],
      }),
      'text',
    );

    expect(text).toBe(
      [
        'ctxlock check https://example.com/acme/skills (HEAD @ 3f2a9c1)',
        '',
        'Runs code when opened (2):',
        '  Claude Code  .claude/settings.json  SessionStart hook runs "./setup.sh"',
        '  Cursor       .cursor/mcp.json       MCP server db runs "npx -y db-mcp"',
        '',
        'Must fix (1):',
        '  L1-hidden-unicode  .cursor/rules/api.mdc:4  hidden character U+200B ZERO WIDTH SPACE at 4:12',
        '',
        'Worth a look (1):',
        '  L2-risky-instruction  AGENTS.md:12  pipes a download into a shell at 12:1',
        '',
        'Review before opening: 2 things run code, 1 must-fix.',
        '',
      ].join('\n'),
    );
  });

  it('says so plainly when nothing runs and nothing must be fixed, and leaves out empty sections', () => {
    expect(renderCheck(result(), 'text')).toBe(
      'ctxlock check https://example.com/acme/skills (HEAD @ 3f2a9c1)\n\nNothing here runs code when opened, and nothing must be fixed.\n',
    );
  });

  it('a must finding alone, with nothing that runs, still asks for a review', () => {
    const must = [{ rule: 'L1-hidden-unicode', severity: 'must' as const, path: 'AGENTS.md', line: 1, message: 'hidden character U+200B ZERO WIDTH SPACE at 1:4' }];

    expect(renderCheck(result({ must }), 'text').trimEnd().split('\n').at(-1)).toBe('Review before opening: 0 things run code, 1 must-fix.');
  });

  it("never prints a control character from the target's files, which could drive the terminal", () => {
    const esc = String.fromCodePoint(0x1b);
    const text = renderCheck(result({ runs: [{ agent: 'Claude Code', file: `.claude/settings${esc}[2J.json`, message: `SessionStart hook runs "x${esc}]0;owned${String.fromCodePoint(7)}"` }] }), 'text');

    expect(text).not.toContain(esc);
    expect(text).toContain('SessionStart hook runs "x?]0;owned?"');
  });

  it('JSON holds the result as it is, with a version', () => {
    const r = result({ runs: [{ agent: 'Cursor', file: '.cursor/mcp.json', message: 'm' }] });

    expect(JSON.parse(renderCheck(r, 'json'))).toEqual({ version: 1, ...r });
  });
});
