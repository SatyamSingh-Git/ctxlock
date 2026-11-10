import { describe, expect, it } from 'vitest';
import { renderSync } from '../../src/report/sync.js';
import { EXEC_REASON, type SyncPlan } from '../../src/sync/sync.js';

const D1 = `sha256:${'a'.repeat(64)}`;
const D2 = `sha256:${'b'.repeat(64)}`;
const plan: SyncPlan = {
  lock: { upstreams: [] },
  moved: [{ upstream: 'platform', ref: 'main', from: '1'.repeat(40), to: '2'.repeat(40) }],
  writes: [],
  removes: [],
  changes: [
    { upstream: 'platform', path: '.agents/skills/api', change: 'added', to: D1 },
    { upstream: 'platform', path: '.claude/rules/testing.md', change: 'updated', from: D1, to: D2 },
    { upstream: 'platform', path: '.claude/rules/old.md', change: 'removed', from: D2 },
    { upstream: 'platform', path: '.claude/rules/same.md', change: 'unchanged', to: D2 },
  ],
  refused: [],
  released: [],
  allowedExec: [],
  skipped: [{ path: '.agents/skills/api/hooks/pre.sh', reason: 'hooks never sync' }],
};

describe('renderSync', () => {
  it('lists each upstream, what changed, and what never syncs', () => {
    expect(renderSync(plan, 'text', true)).toBe(`ctxlock sync

Upstreams:
  platform  main  1111111 → 2222222

Added:
  .agents/skills/api  from platform

Updated:
  .claude/rules/testing.md  from platform  sha256:aaaaaaaaaaaa → sha256:bbbbbbbbbbbb

Removed:
  .claude/rules/old.md  from platform

Not synced:
  .agents/skills/api/hooks/pre.sh  hooks never sync
`);
  });

  it('says when nothing changed, when nothing was written, and what was refused', () => {
    const quiet: SyncPlan = { ...plan, moved: [{ upstream: 'platform', ref: 'main', from: '2'.repeat(40), to: '2'.repeat(40) }], changes: [plan.changes[3]!], skipped: [] };
    expect(renderSync(quiet, 'text', true)).toBe('ctxlock sync\n\nUpstreams:\n  platform  main  2222222\n\nNothing changed.\n');
    expect(renderSync(plan, 'text', false)).toContain('\nA dry run: nothing was written.\n');

    const refused: SyncPlan = { ...plan, refused: [{ path: '.claude/rules/testing.md', reason: 'edited since the last sync' }] };
    expect(renderSync(refused, 'text', false)).toContain(
      'Refused, so nothing was written:\n  .claude/rules/testing.md  edited since the last sync\n\nMake such a change upstream and move the file aside, or take its unit out of upstream units in ctxlock.yaml.\n',
    );
    expect(renderSync(refused, 'text', false)).not.toContain('dry run');
  });

  it('as markdown, a pull request body with every name in code', () => {
    const md = renderSync(plan, 'markdown', true);
    expect(md).toContain('### ctxlock · sync');
    expect(md).toContain('| `.claude/rules/old.md` | `platform` | removed | `sha256:bbbbbbbbbbbb` |');
    expect(md).toContain('| `platform` | `main` | `1111111` → `2222222` |');
    expect(md).toContain('| `.claude/rules/testing.md` | `platform` | updated | `sha256:aaaaaaaaaaaa` → `sha256:bbbbbbbbbbbb` |');
    expect(md).toContain('| `.agents/skills/api` | `platform` | added | `sha256:aaaaaaaaaaaa` |');
    expect(md).toContain('- `.agents/skills/api/hooks/pre.sh`: hooks never sync');
    expect(md).not.toContain('same.md');
  });

  it('names each unit taken though it runs hooks or grants tools, and gives the edit advice only for an edited file', () => {
    const exec: SyncPlan = { ...plan, allowedExec: ['.agents/skills/api'] };
    expect(renderSync(exec, 'text', true)).toContain('\nRuns hooks or grants tools, as allow-exec permits:\n  .agents/skills/api\n');
    expect(renderSync(exec, 'markdown', true)).toContain('\n#### Runs hooks or grants tools, as allow-exec permits\n\n- `.agents/skills/api`\n');

    const refused: SyncPlan = { ...plan, refused: [{ path: '.agents/skills/api', reason: EXEC_REASON }] };
    expect(renderSync(refused, 'text', false)).toContain(`Refused, so nothing was written:\n  .agents/skills/api  ${EXEC_REASON}\n`);
    expect(renderSync(refused, 'text', false)).not.toContain('Make such a change upstream');
    expect(renderSync(refused, 'markdown', false)).not.toContain('Make such a change upstream');
  });

  it("lists the edited files sync leaves as the person's", () => {
    const kept: SyncPlan = { ...plan, released: ['.claude/rules/old.md'] };
    expect(renderSync(kept, 'text', true)).toContain('\nKept as yours, since they were edited here, and no longer synced:\n  .claude/rules/old.md\n');
    expect(renderSync(kept, 'markdown', true)).toContain('\n#### Kept as yours, since they were edited here, and no longer synced\n\n- `.claude/rules/old.md`\n');
    expect(renderSync(plan, 'text', true)).not.toContain('Kept as yours');
  });

  it('JSON is the plan without file contents', () => {
    const withBytes: SyncPlan = { ...plan, writes: [{ path: 'a.md', bytes: Buffer.from('secret body') }] };
    const json = JSON.parse(renderSync(withBytes, 'json', true));
    expect(json.writes).toEqual(['a.md']);
    expect(json.changes).toEqual(plan.changes);
    expect(JSON.stringify(json)).not.toContain('secret');
  });
});
