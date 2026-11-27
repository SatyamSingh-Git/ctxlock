import picomatch from 'picomatch';
import type { Finding } from '../model.js';
import type { LintException } from '../registry/registry.js';
import { htmlComments, textFiles } from './files.js';
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

export const KNOWN_RULES: ReadonlySet<string> = new Set([
  'L0-encoding', 'L0-frontmatter', 'L0-skill-spec', 'L0-symlink-outside',
  'L1-hidden-unicode', 'L1-html-comment',
  'L2-exec-config', 'L2-exec-config-changed', 'L2-exec-config-unread', 'L2-parse', 'L2-risky-instruction',
  'L3-budget', 'L4-discoverable', 'L5-instruction-count', 'L6-skill-length', 'L7-duplicate-skill', 'L8-procedure',
  'L9-import-missing', 'L9-stale', 'L10-owner', 'L11-coverage', 'L13-agents-md-shadowed', 'L14-generated',
  'L15-graph', 'L16-lock', 'L17-format', 'L17-trust-differs',
  'L18-exception-expired', 'L18-suppressed', 'L18-unused',
]);

// Safety rules are excepted only in ctxlock.yaml, judged from the base. A directive in a synced or
// generated file is itself a hand edit to it, so it would excuse its own drift. L18 reports on quieting.
const NEVER_INLINE = /^L(?:0|1|2|14|16|18)-/;
const SAFETY = /^L[012]-/;
// Each id is spelled one way only and ids are separated by required spaces, so a comment that is not
// a directive fails at once; a looser token here backtracked exponentially on a missing colon.
const ID = '(?:L(?:0|[1-9][0-9]*)-[a-z0-9]+(?:-[a-z0-9]+)*|agnix:[A-Za-z0-9_.-]+)';
const DIRECTIVE = new RegExp(`^<!--[ \\t]*ctxlock-ignore-(next-line|file)[ \\t]+(${ID}(?:[ \\t]+${ID})*)[ \\t]*:([^\\n]*?)-->$`);

// One line, a scope, rule ids by syntax (a newer ctxlock's rule is still a rule), and a reason of at most
// 200 characters. Anything else is an ordinary comment.
export function parseDirective(comment: string): Pick<Directive, 'scope' | 'rules' | 'reason'> | null {
  const m = DIRECTIVE.exec(comment);
  if (!m) return null;
  const rules = m[2]!.trim().split(/[ \t]+/);
  const reason = m[3]!.trim();
  if (rules.some((r) => NEVER_INLINE.test(r)) || reason.length === 0 || [...reason].length > 200) return null;
  return { scope: m[1] as Directive['scope'], rules, reason };
}

export async function findDirectives(ctx: LintContext): Promise<Directive[]> {
  const directives: Directive[] = [];
  for await (const { path, text } of textFiles(ctx, undefined, true)) {
    if (!path.endsWith('.md')) continue;
    const lines = text.split(/\r?\n/);
    for (const { comment, line } of htmlComments(text)) {
      const parsed = parseDirective(comment);
      if (!parsed) continue;
      const next = lines.findIndex((l, i) => i >= line && l.trim() !== '');
      directives.push({ path, line, ...parsed, target: parsed.scope === 'next-line' && next !== -1 ? next + 1 : null });
    }
  }
  return directives;
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
  const { ignore } = ctx.registry.lint;
  const exceptions = ctx.suppressions === false ? [] : ctx.registry.lint.exceptions;
  const live = exceptions.filter((e) => ctx.today <= e.expires);
  const report: Finding[] = [];

  const exceptionUse = new Map<LintException, number>();
  // A safety exception excuses the one finding it names: a fingerprint is only the hidden characters
  // themselves, so a second identical character a pull request adds must stay a must.
  const spent = (e: LintException) => SAFETY.test(e.rule) && (exceptionUse.get(e) ?? 0) > 0;
  let kept = found.filter((f) => {
    const e = live.find((x) => !spent(x) && excepts(x, f));
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
    } else if (!ctx.agnixRan && agnixOnly(d.rules)) {
      // Not stale, but its reason is still hidden text, so it is shown here rather than nowhere.
      report.push({ rule: 'L18-unused', severity: 'info', ...at, message: `ctxlock-ignore-${d.scope} ${d.rules.join(' ')} is for agnix, which did not run, so ctxlock cannot tell what it quiets: ${d.reason}` });
    } else {
      const unknown = d.rules.filter((r) => !r.startsWith('agnix:') && !KNOWN_RULES.has(r));
      const why = unknown.length > 0 ? `; ctxlock has no rule ${unknown.join(', ')}` : '';
      report.push({ rule: 'L18-unused', severity: 'should', ...at, message: `ctxlock-ignore-${d.scope} ${d.rules.join(' ')} quiets nothing${why}: ${d.reason}` });
    }
  }
  for (const { p, used } of patterns) {
    if (used === 0) report.push({ rule: 'L18-unused', severity: 'should', path: CONFIG, message: `lint.ignore pattern "${p}" quiets nothing` });
  }
  return [...kept, ...report];
}
