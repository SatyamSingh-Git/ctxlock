import { describe, expect, it } from 'vitest';
import type { Sessions } from '../../src/collect/sessions.js';
import { renderLoads } from '../../src/report/loads.js';

const seen: Sessions = {
  sessions: 20,
  first: '2026-10-30T09:00:00.000Z',
  last: '2026-11-08T18:30:00.000Z',
  units: [
    { id: 'instructions/CLAUDE.md', path: 'CLAUDE.md', sessions: 20, reasons: ['session_start'], lastSeen: '2026-11-08T18:30:00.000Z', otherVersion: 0, predicted: false },
    { id: 'rule/.claude/rules/api.md', path: '.claude/rules/api.md', sessions: 5, reasons: ['compact', 'glob'], lastSeen: '2026-11-07T10:00:00.000Z', otherVersion: 2, predicted: false },
  ],
  unseen: [
    { id: 'rule/.claude/rules/legacy.md', path: '.claude/rules/legacy.md', mode: 'lazy' },
    { id: 'skill/.claude/skills/old', path: '.claude/skills/old', mode: 'listed' },
  ],
  undeclared: true,
  errors: { count: 2, last: 'EACCES: permission denied' },
  skipped: 1,
};

const none: Sessions = { sessions: 0, first: null, last: null, units: [], unseen: [], undeclared: false, errors: { count: 0 }, skipped: 0 };

describe('renderLoads', () => {
  it('lists what loaded and how, what never did, an undeclared consumer, and what the collector could not record', () => {
    expect(renderLoads(seen, 'text')).toBe(`ctxlock loads · 20 Claude Code sessions, 2026-10-30 to 2026-11-08

Loaded:
  CLAUDE.md             20 sessions  session_start  last 2026-11-08
  .claude/rules/api.md  5 sessions   compact, glob  last 2026-11-07  2 on another version

Not loaded in these sessions:
  .claude/rules/legacy.md  lazy
  .claude/skills/old       listed

These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.

Collector errors: 2. The last: EACCES: permission denied
Lines not read: 1
`);
  });

  it('marks a load seen only through the AGENTS.md fallback as predicted, and leaves out empty sections', () => {
    const one: Sessions = {
      ...none,
      sessions: 1,
      first: '2026-11-08T09:00:00.000Z',
      last: '2026-11-08T09:05:00.000Z',
      units: [{ id: 'instructions/AGENTS.md', path: 'AGENTS.md', sessions: 1, reasons: ['session_start'], lastSeen: '2026-11-08T09:00:00.000Z', otherVersion: 0, predicted: true }],
    };
    expect(renderLoads(one, 'text')).toBe(`ctxlock loads · 1 Claude Code session, 2026-11-08

Loaded:
  AGENTS.md  1 session  session_start (predicted)  last 2026-11-08
`);
  });

  it('says how to install the collector when no session was recorded, and still reports its errors', () => {
    const install = `ctxlock loads · no Claude Code sessions recorded for this repository

The collector records which units Claude Code loads in your sessions. To install it:
  claude plugin marketplace add SatyamSingh-Git/ctxlock
  claude plugin install ctxlock@ctxlock
`;
    expect(renderLoads(none, 'text')).toBe(install);
    expect(renderLoads({ ...none, errors: { count: 1, last: 'the hook input is not JSON' } }, 'text')).toBe(
      `${install}\nCollector errors: 1. The last: the hook input is not JSON\n`,
    );
  });

  it('JSON is the result itself', () => {
    expect(JSON.parse(renderLoads(seen, 'json'))).toEqual(seen);
  });
});
