import type { Counter, FixOutcome, Numbers, Outcomes, Window } from '../loop/outcomes.js';
import type { UnitCheck } from '../loop/verify.js';
import { plural } from './markdown.js';
import { printable, table } from './render.js';

const fixes = (n: number) => `${n} ${n === 1 ? 'fix' : 'fixes'}`;
// A fix can ship minutes after its signal, and "0.0 days" would hide it.
function days(n: number): string {
  if (n >= 1) return `${n.toFixed(1)} days`;
  if (n * 24 >= 1) return `${(n * 24).toFixed(1)} hours`;
  return plural(Math.max(1, Math.round(n * 24 * 60)), 'minute');
}

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
  const marks = (c: Counter) => [c.today ? 'today' : '', c.fixed ? 'a fix' : ''].filter(Boolean).join(', ');
  const marked = counters.some((c) => marks(c));
  const rows = counters.map((c, i) => [
    `  ${i > 0 && counters[i - 1]!.unit === c.unit ? '' : c.unit}`,
    c.version === null ? 'unknown bytes' : c.version.slice(0, 12),
    ...(marked ? [marks(c)] : []),
    `helpful ${c.helpful}`,
    `harmful ${c.harmful}`,
  ]);
  return table(rows);
}

function numberRows(n: Numbers): string {
  return table([
    ['  Median time to fix', n.medianDaysToFix === null ? '- (no fix has a recorded signal before it)' : `${days(n.medianDaysToFix)}, over ${fixes(n.timed)}`],
    ['  Regression rate', n.judged ? `${n.regressed} of ${fixes(n.judged)} judged` : "- (no fix's window has closed with sessions in it)"],
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
  if (o.untranscribed) {
    const one = o.untranscribed === 1;
    out.push(`${plural(o.untranscribed, 'recorded session')} ${one ? 'has' : 'have'} no transcript, so ${one ? 'it was' : 'they were'} left out: Claude Code removes transcripts after 30 days by default.`, '');
  }
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

const passes = (head: { passed: number; valid: number } | null) => (head ? `${head.passed} of ${head.valid} passed` : 'not run');

export function renderVerify(r: { checks: UnitCheck[]; runs: number }, format: 'text' | 'json'): string {
  if (format === 'json') {
    const checks = r.checks.map((c) => ({ unit: c.unit.id, check: c.check, probes: c.probes.map((o) => ({ id: o.probe.id, head: o.head })), ...(c.next && { next: c.next }) }));
    return `${JSON.stringify({ checks, runs: r.runs }, null, 2)}\n`;
  }
  if (!r.checks.length) return "ctxlock verify · no unit's stale-after has passed; name one with --unit\n";
  const out = [`ctxlock verify · ${plural(r.checks.length, 'unit')}, ${plural(r.runs, 'run')}`, ''];
  for (const c of r.checks) {
    if (c.check === 'no probes') out.push(`  ${c.unit.id}  no probes: ctxlock probe draft can draft some`);
    else out.push(`  ${c.unit.id}  ${c.check}`, ...c.probes.map((o) => `    ${printable(o.probe.id)}  ${passes(o.head)}`));
  }
  const holding = r.checks.filter((c) => c.next);
  if (holding.length) {
    out.push('', 'In ctxlock.yaml, for the units that hold:', '  units:');
    for (const c of holding) out.push(`    ${c.unit.path}:`, `      verified-at: ${c.next!.verifiedAt}`, `      stale-after: ${c.next!.staleAfter}`);
  }
  return `${out.join('\n')}\n`;
}
