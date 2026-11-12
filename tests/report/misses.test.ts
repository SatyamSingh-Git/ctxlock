import { describe, expect, it } from 'vitest';
import type { Misses, UnitMiss } from '../../src/loop/misses.js';
import { renderMisses } from '../../src/report/misses.js';

const t = (day: number) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const unit = (over: Partial<UnitMiss>): UnitMiss => ({
  id: 'rule/.claude/rules/testing.md',
  path: '.claude/rules/testing.md',
  digest: 'sha256:' + 'a'.repeat(64),
  owners: [],
  upstream: null,
  sessions: 1,
  halved: 0,
  inTurn: 0,
  loadedIn: 2,
  everySession: false,
  olderVersion: 0,
  kinds: { interrupted: 1, correction: 0 },
  first: t(9),
  last: t(9),
  routed: false,
  signals: [],
  ...over,
});
const correction = { session: 's1', kind: 'correction' as const, ts: t(10), untrusted: false, words: 'no, use pnpm test', task: 'run the tests for web', actions: [{ tool: 'Bash', target: 'npm test --workspace web' }], context: ['rule/.claude/rules/testing.md'], turn: ['rule/.claude/rules/testing.md'] };
// Joined to no unit: the collector wasn't recording yet.
const unjoined = { session: 's2', kind: 'correction' as const, ts: t(11), untrusted: false, words: 'actually, keep the old one', actions: [], context: [], turn: [], unrecorded: true as const };

const MISSES: Misses = {
  sessions: 9,
  withTranscript: 7,
  withSignal: 3,
  signals: { interrupted: 1, correction: 2 },
  untrusted: 1,
  unattributed: 1,
  unrecorded: 2,
  since: null,
  minSessions: 3,
  found: [correction, unjoined],
  units: [
    unit({ sessions: 3, inTurn: 2, loadedIn: 5, owners: ['@platform'], routed: true, kinds: { interrupted: 1, correction: 2 }, signals: [correction] }),
    unit({ id: 'skill/.claude/skills/release', path: '.claude/skills/release', upstream: { name: 'platform', repo: '../org' } }),
    unit({ id: 'instructions/CLAUDE.md', path: 'CLAUDE.md', sessions: 2.5, loadedIn: 9, everySession: true }),
  ],
};

describe('renderMisses', () => {
  it('text lists units by sessions, marks routed and everySession, and names an upstream', () => {
    expect(renderMisses(MISSES, 'text', false)).toBe(`ctxlock misses · 9 sessions, 7 with a transcript

Signals: 1 interrupted · 2 corrections, in 3 sessions · 1 after web or MCP content

Units in context when the agent was stopped or corrected:
  rule/.claude/rules/testing.md  3 sessions  2 in its turn  loaded in 5  owner @platform  routed
  skill/.claude/skills/release   1 session                  loaded in 2  from platform

In every session, so exposure can't single them out:
  instructions/CLAUDE.md  2.5 sessions    loaded in 9

With no unit of this repository in context: 1 signal
Before the collector recorded the session: 2 signals
Routed at 3 sessions or more: 1 unit. Write drafts with --drafts <folder>.
`);
  });

  it('json and text hold no words without --excerpts, and do with it', () => {
    for (const format of ['text', 'json'] as const) {
      expect(renderMisses(MISSES, format, false), format).not.toContain('use pnpm test');
      for (const said of ['run the tests for web', 'npm test --workspace']) expect(renderMisses(MISSES, format, false), format).not.toContain(said);
      expect(renderMisses(MISSES, format, true), format).toContain('no, use pnpm test');
    }
    const json = JSON.parse(renderMisses(MISSES, 'json', false));
    expect(json.found[0]).toEqual({ session: 's1', kind: 'correction', ts: t(10), untrusted: false, context: ['rule/.claude/rules/testing.md'], turn: ['rule/.claude/rules/testing.md'] });
    // Each unit points into found, rather than repeating its signals.
    expect(json.units.map((u: { signals: number[] }) => u.signals)).toEqual([[0], [], []]);
    expect(renderMisses(MISSES, 'text', true)).toContain('\nCorrections:\n  2026-11-10  no, use pnpm test\n  2026-11-11  actually, keep the old one\n');
    const broken = { ...MISSES, found: [{ ...correction, words: 'no,\r\nuse pnpm\ntest' }] };
    expect(renderMisses(broken, 'text', true)).toContain('\nCorrections:\n  2026-11-10  no, use pnpm test\n');
  });

  it('says when nothing is routed, when there are no signals, and when no session was recorded', () => {
    const quiet: Misses = { ...MISSES, withSignal: 0, signals: { interrupted: 0, correction: 0 }, untrusted: 0, unattributed: 0, unrecorded: 0, units: [], since: '2026-11-10' };
    expect(renderMisses(quiet, 'text', false)).toBe(`ctxlock misses · 9 sessions, 7 with a transcript · since 2026-11-10

Signals: none
`);
    expect(renderMisses({ ...MISSES, units: MISSES.units.map((u) => ({ ...u, routed: false })) }, 'text', false)).toContain('\nNone reached 3 sessions, so nothing is routed.\n');
    expect(renderMisses({ ...quiet, sessions: 0, withTranscript: 0 }, 'text', false)).toMatch(/^ctxlock misses · no Claude Code sessions recorded for this repository\n\nThe collector records/);
  });
});
