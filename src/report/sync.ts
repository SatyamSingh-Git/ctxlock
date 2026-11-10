import { EXEC_REASON, type SyncChange, type SyncPlan } from '../sync/sync.js';
import { block, shortDigest as short } from './graph.js';
import { cell, code } from './markdown.js';

const ADVICE = 'Make such a change upstream and move the file aside, or take its unit out of upstream units in ctxlock.yaml.';
const EXEC = 'Runs hooks or grants tools, as allow-exec permits';
// The advice fits a file someone edited or owns; a unit refused for what it runs says its own fix.
const advice = (plan: SyncPlan) => (plan.refused.some((r) => r.reason !== EXEC_REASON) ? ['', ADVICE] : []);
const KEPT = 'Kept as yours, since they were edited here, and no longer synced';
const commits = (from: string | null, to: string) => (from === null || from === to ? [to.slice(0, 7)] : [from.slice(0, 7), to.slice(0, 7)]);
const digests = (c: SyncChange) => (c.change === 'updated' ? [short(c.from!), short(c.to!)] : [short((c.to ?? c.from)!)]);

// What sync wrote, or would write; `applied` is false for a dry run or a refused sync. `fill` is what
// build's fill wrote and removed after it, so a synced skill reaches every agent, and a dropped one none.
export function renderSync(plan: SyncPlan, format: 'text' | 'json' | 'markdown', applied: boolean, fill: { written: string[]; removed: string[] } = { written: [], removed: [] }): string {
  if (format === 'json') return `${JSON.stringify({ ...plan, writes: plan.writes.map((w) => w.path), applied, fill }, null, 2)}\n`;
  const changed = plan.changes.filter((c) => c.change !== 'unchanged');

  if (format === 'markdown') {
    const lines = ['### ctxlock · sync', '', '| Upstream | Ref | Commit |', '|---|---|---|'];
    for (const m of plan.moved) lines.push(`| ${cell(code(m.upstream))} | ${cell(code(m.ref))} | ${commits(m.from, m.to).map(code).join(' → ')} |`);
    lines.push('', '#### Changes', '');
    if (changed.length === 0) lines.push('Nothing changed.');
    else {
      lines.push(
        '| Unit | Upstream | Change | Digest |',
        '|---|---|---|---|',
        ...changed.map((c) => `| ${cell(code(c.path))} | ${cell(code(c.upstream))} | ${c.change} | ${digests(c).map(code).join(' → ')} |`),
      );
    }
    if (fill.written.length) lines.push('', '#### Filled, so every agent loads it', '', ...fill.written.map((f) => `- ${code(f)}`));
    if (fill.removed.length) lines.push('', '#### Removed from the other agents with it', '', ...fill.removed.map((f) => `- ${code(f)}`));
    if (plan.allowedExec.length) lines.push('', `#### ${EXEC}`, '', ...plan.allowedExec.map((p) => `- ${code(p)}`));
    if (plan.released.length) lines.push('', `#### ${KEPT}`, '', ...plan.released.map((p) => `- ${code(p)}`));
    if (plan.skipped.length) lines.push('', '#### Not synced', '', ...plan.skipped.map((s) => `- ${code(s.path)}: ${s.reason}`));
    if (plan.refused.length) lines.push('', '#### Refused, so nothing was written', '', ...plan.refused.map((r) => `- ${code(r.path)}: ${r.reason}`), ...advice(plan));
    return `${lines.join('\n')}\n`;
  }

  const of = (change: SyncChange['change']) => changed.filter((c) => c.change === change);
  const lines = [
    'ctxlock sync',
    ...block('Upstreams', plan.moved.map((m) => [m.upstream, m.ref, commits(m.from, m.to).join(' → ')])),
    ...(changed.length === 0
      ? ['', 'Nothing changed.']
      : [
          ...block('Added', of('added').map((c) => [c.path, `from ${c.upstream}`])),
          ...block('Updated', of('updated').map((c) => [c.path, `from ${c.upstream}`, digests(c).join(' → ')])),
          ...block('Removed', of('removed').map((c) => [c.path, `from ${c.upstream}`])),
        ]),
    ...block('Filled, so every agent loads it', fill.written.map((f) => [f])),
    ...block('Removed from the other agents with it', fill.removed.map((f) => [f])),
    ...block(EXEC, plan.allowedExec.map((p) => [p])),
    ...block(KEPT, plan.released.map((p) => [p])),
    ...block('Not synced', plan.skipped.map((s) => [s.path, s.reason])),
    ...(plan.refused.length ? [...block('Refused, so nothing was written', plan.refused.map((r) => [r.path, r.reason])), ...advice(plan)] : []),
    ...(!applied && plan.refused.length === 0 ? ['', 'A dry run: nothing was written.'] : []),
  ];
  return `${lines.join('\n')}\n`;
}
