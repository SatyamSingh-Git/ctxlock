import picomatch from 'picomatch';
import type { Finding } from '../model.js';
import type { LintException } from '../registry/registry.js';
import type { LintContext } from './types.js';

export interface Directive {
  path: string;
  line: number;
  scope: 'next-line' | 'file';
  rules: string[];
  reason: string;
  // The first non-blank line after a next-line directive; null for a file directive or none.
  target: number | null;
}

const CONFIG = 'ctxlock.yaml';
const findings = (n: number) => `${n} ${n === 1 ? 'finding' : 'findings'}`;
// agnix's rules exist only in a run that ran it, so naming one is not stale when it did not run.
const agnixOnly = (rules: string[]) => rules.every((r) => r.startsWith('agnix:'));

const excepts = (e: LintException, f: Finding) =>
  f.rule === e.rule && f.path === e.path && (e.fingerprint === undefined || f.data?.fingerprint === e.fingerprint) && (e.match === undefined || f.message.includes(e.match));

const quiets = (d: Directive, f: Finding) => f.path === d.path && d.rules.includes(f.rule) && (d.scope === 'file' || (f.line !== undefined && f.line === d.target));

// Exceptions, then directives, then lint.ignore: a finding quieted by one step is not there for the next,
// so it counts as used only once. The L18 findings come after every step, so nothing can drop them.
export function quiet(found: Finding[], ctx: LintContext, directives: Directive[]): Finding[] {
  const { exceptions, ignore } = ctx.registry.lint;
  const live = exceptions.filter((e) => ctx.today <= e.expires);
  const report: Finding[] = [];

  const exceptionUse = new Map<LintException, number>();
  let kept = found.filter((f) => {
    const e = live.find((x) => excepts(x, f));
    if (e) exceptionUse.set(e, (exceptionUse.get(e) ?? 0) + 1);
    return !e;
  });

  const directiveUse = new Map<Directive, number>();
  kept = kept.filter((f) => {
    const d = directives.find((x) => quiets(x, f));
    if (d) directiveUse.set(d, (directiveUse.get(d) ?? 0) + 1);
    return !d;
  });

  const patterns = ignore.map((p) => ({ p, match: picomatch(p, { dot: true }), used: 0 }));
  kept = kept.filter((f) => {
    const hit = f.path === undefined ? undefined : patterns.find((x) => x.match(f.path!));
    if (hit) hit.used++;
    return !hit;
  });

  for (const e of exceptions) {
    const n = exceptionUse.get(e) ?? 0;
    const where = `exception for ${e.rule} on ${e.path}`;
    if (!live.includes(e)) {
      report.push({ rule: 'L18-exception-expired', severity: 'should', path: CONFIG, message: `${where} expired on ${e.expires} (owner ${e.owner}); its findings are back` });
    } else if (n > 0) {
      report.push({ rule: 'L18-suppressed', severity: 'info', path: e.path, message: `${where} quiets ${findings(n)}, owner ${e.owner}, until ${e.expires}: ${e.reason}` });
    } else if (ctx.agnixRan || !agnixOnly([e.rule])) {
      report.push({ rule: 'L18-unused', severity: 'should', path: CONFIG, message: `${where} quiets nothing` });
    }
  }
  for (const d of directives) {
    const n = directiveUse.get(d) ?? 0;
    const at = { path: d.path, line: d.line };
    if (n > 0) {
      report.push({ rule: 'L18-suppressed', severity: 'info', ...at, message: `ctxlock-ignore-${d.scope} quiets ${findings(n)} of ${d.rules.join(', ')}: ${d.reason}` });
    } else if (ctx.agnixRan || !agnixOnly(d.rules)) {
      report.push({ rule: 'L18-unused', severity: 'should', ...at, message: `ctxlock-ignore-${d.scope} ${d.rules.join(' ')} quiets nothing: ${d.reason}` });
    }
  }
  for (const { p, used } of patterns) {
    if (used === 0) report.push({ rule: 'L18-unused', severity: 'should', path: CONFIG, message: `lint.ignore pattern "${p}" quiets nothing` });
  }
  return [...kept, ...report];
}
