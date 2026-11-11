import { describe, expect, it } from 'vitest';
import type { UnitMiss } from '../../src/loop/misses.js';
import { draftName, draftState, renderDraft } from '../../src/loop/draft.js';

const t = (day: number) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const ID = 'rule/.claude/rules/testing.md';
const signal = (session: string, kind: 'interrupted' | 'correction', day: number, words?: string, untrusted = false) => ({ session, kind, ts: t(day), untrusted, context: [ID], turn: [ID], ...(words !== undefined && { words }) });
const MISS: UnitMiss = {
  id: ID,
  path: '.claude/rules/testing.md',
  digest: `sha256:${'c'.repeat(64)}`,
  owners: ['@platform'],
  upstream: null,
  sessions: 2.5,
  halved: 1,
  inTurn: 2,
  loadedIn: 5,
  everySession: false,
  olderVersion: 1,
  kinds: { interrupted: 2, correction: 1 },
  first: t(8),
  last: t(11),
  routed: true,
  signals: [signal('s1', 'interrupted', 8), signal('s2', 'correction', 10, 'no, ping @octocat: see [this](https://x.example) and ``code``'), signal('s3', 'interrupted', 11, undefined, true)],
};

describe('renderDraft', () => {
  it("a draft names the unit's owners and repository, counts sessions and signals, and holds no words without excerpts", () => {
    const draft = renderDraft(MISS, 'https://github.com/acme/web.git', false);

    expect(draft.split('\n')[0]).toMatch(/^<!-- ctxlock:miss rule\/\.claude\/rules\/testing\.md \S+ -->$/);
    expect(draft).toContain('# ctxlock: `rule/.claude/rules/testing.md` was in play when the agent was stopped or corrected');
    expect(draft).toContain('- **Belongs in:** `https://github.com/acme/web.git`');
    expect(draft).toContain('- **Owners:** @platform');
    expect(draft).toContain('- **Sessions:** 2.5, of 5 that loaded it; 1 counted at half, since it had read web or MCP content first');
    expect(draft).toContain('- **Signals:** 2 interrupted, 1 correction, from 2026-11-08 to 2026-11-11; 2 came in the turn it loaded');
    expect(renderDraft({ ...MISS, inTurn: 0 }, 'web', false)).toContain('from 2026-11-08 to 2026-11-11\n');
    expect(draft).toContain(`- **Digest today:** \`sha256:${'c'.repeat(64)}\`; 1 of these sessions loaded other bytes`);
    expect(draft).toContain('These are signals, not a diagnosis');
    expect(draft).not.toContain('octocat');
    expect(renderDraft({ ...MISS, owners: [] }, 'web', false)).toContain('- **Owners:** none in ctxlock.yaml or CODEOWNERS');
    expect(renderDraft({ ...MISS, everySession: true }, 'web', false)).toContain("It loaded in every session, so exposure alone can't single it out.");
  });

  it('with excerpts, an @mention, a backtick run and a markdown link stay inside a fence that outlasts them', () => {
    const draft = renderDraft(MISS, 'web', true);

    expect(draft).toContain('## What was typed\n\n2026-11-10:\n\n```\nno, ping @octocat: see [this](https://x.example) and ``code``\n```\n');
    const long = renderDraft({ ...MISS, signals: [signal('s2', 'correction', 10, 'no, use ``` fences ````')] }, 'web', true);
    expect(long).toContain('\n`````\nno, use ``` fences ````\n`````\n');
    const mailed = renderDraft({ ...MISS, signals: [signal('s2', 'correction', 10, 'no, mail sam@example.com instead')] }, 'web', true);
    expect(mailed).toContain('no, mail <email> instead');
    expect(mailed).not.toContain('sam@example.com');
  });

  it("a synced unit's draft names the upstream's repository", () => {
    const draft = renderDraft({ ...MISS, owners: [], upstream: { name: 'platform', repo: 'https://github.com/acme/context.git' } }, 'https://github.com/acme/context.git', false);

    expect(draft).toContain('- **Belongs in:** `https://github.com/acme/context.git`, the upstream `platform` this repository syncs it from');
  });
});

describe('draftState', () => {
  it("tells a draft as ctxlock wrote it from one edited since, and from a file that is not this unit's draft", () => {
    const draft = renderDraft(MISS, 'web', false);

    expect(draftState(draft, ID)).toBe('unedited');
    expect(draftState(draft.replaceAll('\n', '\r\n'), ID)).toBe('unedited');
    expect(draftState(draft.replace('These are signals', 'Fixed in #12. These are signals'), ID)).toBe('edited');
    expect(draftState(draft, 'rule/.claude/rules/other.md')).toBe('other');
    expect(draftState('My own notes.\n', ID)).toBe('other');
  });
});

describe('draftName', () => {
  it('turns an id into a file name', () => {
    expect(draftName(ID)).toBe('rule-.claude-rules-testing.md.md');
    expect(draftName('skill/.agents/skills/release')).toBe('skill-.agents-skills-release.md');
    expect(draftName('skill/.claude/skills/my notes: v2')).toBe('skill-.claude-skills-my-notes--v2.md');
  });
});
