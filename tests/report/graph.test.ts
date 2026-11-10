import { describe, expect, it } from 'vitest';
import type { Impact, WhoUses } from '../../src/graph/graph.js';
import { renderImpact, renderWhoUses } from '../../src/report/graph.js';

const A = 'rule/.claude/rules/a.md';
const B = 'rule/.claude/rules/b.md';
const C = 'rule/.claude/rules/c.md';

const who: WhoUses = {
  id: 'skill/.agents/skills/release',
  units: [
    { id: B, via: [] },
    { id: C, via: [B] },
  ],
  consumers: [{ name: 'payments-api', owner: '@payments-team', maturity: 'production', via: [C, B] }],
  loads: [{ harness: 'codex', site: '', mode: 'listed' }],
  generated: ['.claude/skills/release/SKILL.md'],
};

const impact: Impact = {
  changed: [{ id: A, change: 'modified' }],
  dependents: [
    { id: B, via: [], on: A },
    { id: C, via: [B], on: A },
  ],
  consumers: [{ name: 'payments-api', owner: '@payments-team', maturity: 'production', via: [C, B] }],
  owners: ['@payments-team', '@rules-team'],
};

describe('renderWhoUses', () => {
  it('lists what depends on a unit and through what, its consumers, the agents that load it, and what was generated from it', () => {
    expect(renderWhoUses(who, 'text')).toBe(`ctxlock who-uses · .agents/skills/release

Units that depend on it:
  .claude/rules/b.md
  .claude/rules/c.md  through .claude/rules/b.md

Consumers:
  payments-api  @payments-team  production  through .claude/rules/c.md, .claude/rules/b.md

Loaded by (predicted):
  codex  .  listed

Generated from it:
  .claude/skills/release/SKILL.md
`);
  });

  it('says when nothing depends on it and no agent loads it, and JSON is the result itself', () => {
    expect(renderWhoUses({ ...who, units: [], consumers: [], loads: [], generated: [] }, 'text')).toBe(
      'ctxlock who-uses · .agents/skills/release\n\nNothing in ctxlock.yaml depends on it.\n\nNo configured agent loads it.\n',
    );
    expect(JSON.parse(renderWhoUses(who, 'json'))).toEqual(who);
  });

  it('adds the recorded sessions that loaded it, only when there are any', () => {
    const unit = { id: who.id, path: '.agents/skills/release', sessions: 14, reasons: ['skill_invoked'], lastSeen: '2026-11-08T10:00:00.000Z', otherVersion: 0, predicted: false };

    expect(renderWhoUses({ ...who, generated: [], observed: { sessions: 20, unit } }, 'text')).toContain(
      'Loaded by (predicted):\n  codex  .  listed\n\nLoaded in sessions (observed):\n  claude-code  14 of 20 sessions  skill_invoked  last 2026-11-08\n',
    );
    expect(renderWhoUses({ ...who, observed: { sessions: 1, unit: null } }, 'text')).toContain(
      'Loaded in sessions (observed):\n  claude-code  0 of 1 session\n\nGenerated from it:',
    );
    expect(renderWhoUses(who, 'text')).not.toContain('observed');
  });
});

describe('renderImpact', () => {
  it('lists the changes, what depends on them and through what, the consumers, and the owners to ask', () => {
    expect(renderImpact(impact, 'text')).toBe(`ctxlock impact

Changed:
  .claude/rules/a.md  modified

Depends on what changed:
  .claude/rules/b.md
  .claude/rules/c.md  through .claude/rules/b.md

Consumers:
  payments-api  @payments-team  production  through .claude/rules/c.md, .claude/rules/b.md

Owners to ask: @payments-team, @rules-team
`);
  });

  it('shows every name as code in markdown, so no owner is notified and no text renders', () => {
    expect(renderImpact(impact, 'markdown')).toBe(`### ctxlock · impact

#### Changed units

| Unit | Change |
|---|---|
| \`.claude/rules/a.md\` | modified |

#### Impact

| Depends on what changed | Through |
|---|---|
| \`.claude/rules/b.md\` |  |
| \`.claude/rules/c.md\` | \`.claude/rules/b.md\` |

| Consumer | Owner | Maturity | Through |
|---|---|---|---|
| \`payments-api\` | \`@payments-team\` | production | \`.claude/rules/c.md\`, \`.claude/rules/b.md\` |

Owners to ask: \`@payments-team\`, \`@rules-team\`
`);
  });

  it('with only changes, leaves out what nothing fills, and JSON is the result itself', () => {
    const plain: Impact = { changed: impact.changed, dependents: [], consumers: [], owners: [] };
    expect(renderImpact(plain, 'text')).toBe('ctxlock impact\n\nChanged:\n  .claude/rules/a.md  modified\n');
    expect(renderImpact({ ...plain, changed: [] }, 'text')).toBe('ctxlock impact\n\nNo context units changed.\n');
    expect(renderImpact(plain, 'markdown')).toBe('### ctxlock · impact\n\n#### Changed units\n\n| Unit | Change |\n|---|---|\n| `.claude/rules/a.md` | modified |\n');
    expect(JSON.parse(renderImpact(impact, 'json'))).toEqual(impact);
  });

  it('lists the repositories that pin a changed unit, every name as code in markdown, and says when none does', () => {
    const plain: Impact = { changed: impact.changed, dependents: [], consumers: [], owners: [] };
    const pin = { repo: 'https://github.com/acme/pay|ments', lockPath: '/w/p/ctxlock.lock', upstream: 'platform', unit: '.claude/rules/a.md', digest: `sha256:${'c'.repeat(64)}` };
    expect(renderImpact({ ...plain, pinned: [pin] }, 'markdown')).toContain(
      '\n\n#### Pinned by other repositories\n\n| Repository | Unit | Digest | Upstream |\n|---|---|---|---|\n| `https://github.com/acme/pay\\|ments` | `.claude/rules/a.md` | `sha256:cccccccccccc` | `platform` |\n',
    );
    expect(renderImpact({ ...plain, pinned: [] }, 'markdown')).toContain('\n\nNo repository under the --locks paths pins what changed.\n');
    expect(renderImpact({ ...plain, pinned: [] }, 'text')).toBe('ctxlock impact\n\nChanged:\n  .claude/rules/a.md  modified\n\nNo repository under the --locks paths pins what changed.\n');
  });
});
