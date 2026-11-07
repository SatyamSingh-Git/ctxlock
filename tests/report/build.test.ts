import { describe, expect, it } from 'vitest';
import { type BuildReport, renderBuild } from '../../src/report/build.js';

const report = (extra: Partial<BuildReport> = {}): BuildReport => ({
  root: '/repo',
  budget: [{ harness: 'codex', site: '', alwaysBytes: 0, limitBytes: 32768, catalogChars: 0, catalogLimit: 8000, truncated: [] }],
  after: [{ harness: 'codex', site: '', alwaysBytes: 1001, limitBytes: 32768, catalogChars: 0, catalogLimit: 8000, truncated: [] }],
  gaps: [
    { path: '.agents/skills/release', harness: 'claude-code', fill: '.claude/skills/release', reason: 'a copy of the skill' },
    { path: '.claude/rules/ts.md', harness: 'codex', fill: null, reason: 'Codex cannot scope **/*.ts' },
  ],
  drift: [{ paths: ['CLAUDE.md', 'AGENTS.md'], summary: '1 line only in CLAUDE.md, 1 only in AGENTS.md' }],
  generated: [{ path: 'AGENTS.md', state: 'stale', source: 'CLAUDE.md' }],
  generatedError: null,
  written: [],
  removed: [],
  refused: [],
  filled: false,
  ...extra,
});

describe('renderBuild', () => {
  it('reports the budget before and after a fill, each gap with its fill or why there is none, drift and generated files', () => {
    const text = renderBuild(report(), 'text');

    expect(text).toContain('ctxlock build · /repo');
    expect(text).toMatch(/Budget:\nharness\s+site\s+always bytes\s+skill catalog\s+cut\ncodex\s+\.\s+0 \/ 32768/);
    expect(text).toMatch(/Budget after --fill-missing:\nharness.*\ncodex\s+\.\s+1001 \/ 32768/);
    expect(text).toMatch(/Gaps:\n {2}\.agents\/skills\/release does not reach claude-code\s+fill: \.claude\/skills\/release \(a copy of the skill\)\n {2}\.claude\/rules\/ts\.md does not reach codex\s+no fill: Codex cannot scope \*\*\/\*\.ts/);
    expect(text).toContain('Drift:\n  CLAUDE.md and AGENTS.md: 1 line only in CLAUDE.md, 1 only in AGENTS.md');
    expect(text).toMatch(/Generated \(\.ctxlock\/generated\.json\):\n {2}AGENTS\.md\s+stale: CLAUDE\.md changed/);
    expect(text.trimEnd().endsWith('ctxlock build --fill-missing writes the 1 fill above.')).toBe(true);
  });

  it('after a fill lists what it wrote and refused, and only the gaps still open', () => {
    const text = renderBuild(report({ filled: true, written: ['.claude/skills/release/SKILL.md'], removed: ['.claude/skills/release/old.sh'], refused: ['AGENTS.md'] }), 'text');

    expect(text).toContain('Wrote:\n  .claude/skills/release/SKILL.md');
    expect(text).toContain('Removed, since its source is gone:\n  .claude/skills/release/old.sh');
    expect(text).toContain('Left as it is, since a person wrote or edited it after the plan:\n  AGENTS.md');
    expect(text).not.toContain('.agents/skills/release does not reach');
    expect(text).toContain('.claude/rules/ts.md does not reach codex');
    expect(text).not.toContain('--fill-missing writes');
    expect(text).not.toContain('Budget after');
  });

  it('says when the record is not valid, and offers no fill, which would stop on it', () => {
    const text = renderBuild(report({ generated: [], generatedError: 'Unexpected end of JSON input' }), 'text');

    expect(text).toContain('\n.ctxlock/generated.json is not valid: Unexpected end of JSON input; fix it before --fill-missing, which would replace it\n');
    expect(text).not.toContain('--fill-missing writes');
  });

  it('leaves out empty sections, and JSON is the report itself', () => {
    const quiet = report({ after: null, gaps: [], drift: [], generated: [] });
    const text = renderBuild(quiet, 'text');

    expect(text).not.toMatch(/Gaps:|Drift:|Generated|after --fill-missing|Wrote:/);
    expect(text).toContain('No gaps between the configured agents.');
    expect(JSON.parse(renderBuild(quiet, 'json'))).toEqual(quiet);
  });
});
