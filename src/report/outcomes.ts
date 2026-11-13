import type { Counter, FixOutcome, Numbers, Outcomes, Window } from '../loop/outcomes.js';
import { plural } from './markdown.js';
import { printable, table } from './render.js';

const fixes = (n: number) => `${n} ${n === 1 ? 'fix' : 'fixes'}`;
const days = (n: number) => `${n.toFixed(1)} days`;

function window(w: Window): string {
  const label = `${w.days} days`.padEnd(7);
  if (w.status === 'held') return `${label}  held, in ${plural(w.sessions, 'session')} that loaded the fix`;
  if (w.status === 'missed again') return `${label}  missed again: ${w.missed} of ${plural(w.sessions, 'session')} that loaded the fix had a signal`;
  if (w.status === 'no sessions') return `${label}  no session loaded the fix`;
  return `${label}  pending: so far ${plural(w.sessions, 'session')}${w.missed ? `, ${w.missed} with a signal` : ''}`;
}

function fix(o: FixOutcome): string[] {
  const after = o.daysToFix === null ? 'with no recorded signal before it' : `${days(o.daysToFix)} after its first signal`;
  const reached = [o.consumers.map(printable).join(', '), o.pinnedBy.length ? `pinned by ${o.pinnedBy.map(printable).join(', ')}` : ''].filter(Boolean).join('; ');
  return [
    `  ${o.fix.unit}  shipped ${o.fix.shippedAt.slice(0, 10)} in ${o.fix.commit.slice(0, 7)}, ${after}`,
    ...(o.fix.unchanged ? ['    Its commit added the probe and left the unit as it was.'] : []),
    ...o.windows.map((w) => `    ${window(w)}`),
    ...(o.probe ? [`    Its probe today: ${o.probe}`] : []),
    `    Reached: ${reached || 'no declared consumer, and no repository pins it'}`,
  ];
}

function counterRows(counters: Counter[]): string {
  const rows = counters.map((c, i) => [
    `  ${i > 0 && counters[i - 1]!.unit === c.unit ? '' : c.unit}`,
    c.version === null ? 'unknown bytes' : c.version.slice(0, 12),
    [c.today ? 'today' : '', c.fixed ? 'a fix' : ''].filter(Boolean).join(', '),
    `helpful ${c.helpful}`,
    `harmful ${c.harmful}`,
  ]);
  return table(rows);
}

function numberRows(n: Numbers): string {
  return table([
    ['  Median time to fix', n.medianDaysToFix === null ? '- (no fix has a recorded signal before it)' : `${days(n.medianDaysToFix)}, over ${fixes(n.timed)}`],
    ['  Regression rate', n.judged7 ? `${n.regressed} of ${fixes(n.judged7)} judged` : "- (no fix's 7-day window has closed and been judged)"],
    ['  Durability at 30 days', n.judged30 ? `${n.held30} of ${n.judged30} held` : '- (no 30-day window has closed and been judged)'],
    ['  Fixes × consumers', n.fixes ? `${n.reached}, over ${fixes(n.fixes)}` : '- (no shipped fix)'],
    ['  Never loaded', n.sessions ? `${n.neverLoaded} of ${plural(n.loadable, 'unit')}, in ${plural(n.sessions, 'session')}; ctxlock loads lists them` : '- (no recorded session)'],
  ]);
}

export function renderOutcomes(o: Outcomes, format: 'text' | 'json'): string {
  if (format === 'json') {
    const json = {
      ...o,
      fixes: o.fixes.map((f) => ({
        unit: f.fix.unit,
        probe: f.fix.probe.id,
        commit: f.fix.commit,
        shippedAt: f.fix.shippedAt,
        unchanged: f.fix.unchanged,
        versions: f.fix.versions,
        firstSignal: f.firstSignal,
        daysToFix: f.daysToFix,
        windows: f.windows,
        consumers: f.consumers,
        pinnedBy: f.pinnedBy,
        ...(f.probe && { verified: f.probe }),
      })),
    };
    return `${JSON.stringify(json, null, 2)}\n`;
  }
  const out = [`ctxlock outcomes · ${plural(o.sessions, 'session')} recorded`, ''];
  if (!o.git) out.push('Not a git repository, so no fix can be found shipped.');
  else if (!o.fixes.length) out.push('No shipped fix: a fix ships when the probe ctxlock diagnose wrote for it is committed.');
  else out.push('Shipped fixes:', ...o.fixes.flatMap(fix));
  if (o.orphans.length) out.push('', 'Probes whose unit is gone:', ...o.orphans.map((id) => `  ${printable(id)}`));
  out.push('');
  if (!o.counters.length) out.push('Helpful and harmful: no recorded session loaded a unit.');
  else {
    out.push(
      'Helpful and harmful, by the version loaded:',
      counterRows(o.counters),
      '  Harmful counts sessions with a signal while the unit was in context, not proven harm; a session whose signals all followed web or MCP content counts half.',
    );
  }
  out.push('', 'The numbers:', numberRows(o.numbers));
  return `${out.join('\n')}\n`;
}
