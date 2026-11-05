import type { DiffResult } from '../diff.js';
import type { Finding } from '../model.js';
import type { ScanResult } from '../scan.js';

const site = (s: string) => s || '.';

// Columns padded to their widest cell, two spaces apart; the last column is not padded.
function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]! + 2))).join('').trimEnd()).join('\n');
}

function counts(findings: Finding[]): string {
  const n = (severity: Finding['severity']) => findings.filter((f) => f.severity === severity).length;
  return `${n('must')} must, ${n('should')} should, ${n('info')} info`;
}

function findingLines(findings: Finding[]): string {
  if (findings.length === 0) return 'no findings';
  const rows = findings.map((f) => [f.severity, f.rule, f.path === undefined ? '' : `${f.path}${f.line ? `:${f.line}` : ''}`, f.message]);
  return `${table(rows)}\n\n${counts(findings)}`;
}

function scanText(r: ScanResult): string {
  const units = r.units.map((u) => [`  ${u.kind}`, u.aliases.length ? `${u.path} (also at ${u.aliases.join(', ')})` : u.path]);
  const contexts = r.contexts.map((c) => {
    const n = (mode: string) => c.entries.filter((e) => e.mode === mode).length;
    return `  ${c.harness} at ${site(c.site)}: ${n('always')} always (${c.alwaysBytes} bytes), ${n('lazy')} lazy, ${n('listed')} listed`;
  });
  return [
    `ctxlock scan of ${r.root} (${r.ref === null ? 'working tree' : `ref ${r.ref}`})`,
    '',
    `${r.units.length} unit${r.units.length === 1 ? '' : 's'}`,
    ...(units.length ? [table(units)] : []),
    '',
    'What each agent loads at each site:',
    ...contexts,
    '',
    `findings: ${counts(r.findings)}${r.findings.length ? ' (ctxlock lint lists them)' : ''}`,
  ].join('\n');
}

function budgetText(r: ScanResult): string {
  const rows = r.budget.map((b) => [
    b.harness,
    site(b.site),
    b.limitBytes === null ? `${b.alwaysBytes}` : `${b.alwaysBytes} / ${b.limitBytes}`,
    b.catalogLimit === null ? `${b.catalogChars}` : `${b.catalogChars} / ${b.catalogLimit}`,
    b.truncated.length ? b.truncated.join(', ') : '-',
  ]);
  return table([['harness', 'site', 'always bytes', 'skill catalog', 'cut'], ...rows]);
}

// JSON carries ids, paths and digests, never a unit's text.
function scanJson(r: ScanResult, view: 'scan' | 'lint' | 'budget'): object {
  const head = { version: 1, root: r.root, ref: r.ref };
  if (view === 'lint') return { ...head, findings: r.findings };
  if (view === 'budget') return { ...head, budget: r.budget };
  return {
    ...head,
    units: r.units.map(({ id, kind, path, name, digest, aliases }) => ({ id, kind, path, name, digest, aliases })),
    contexts: r.contexts,
    budget: r.budget,
    findings: r.findings,
  };
}

function diffText(d: DiffResult): string {
  const blocking = [...d.newFindings, ...d.execChanges].filter((f) => f.severity === 'must').length;
  const head = d.head.ref === null ? 'working tree' : d.head.ref;
  const budget = d.budget.map((b) => [`  ${b.harness}`, site(b.site), `${b.baseAlwaysBytes} -> ${b.alwaysBytes}`, b.limitBytes === null ? '' : `limit ${b.limitBytes}`]);
  return [
    `ctxlock diff ${d.base.ref} -> ${head}`,
    blocking > 0 ? `${blocking} must-fix` : 'no must-fix issues',
    ...(d.existingMust > 0 ? [`(${d.existingMust} must already on the base, not counted)`] : []),
    '',
    'Changed units:',
    ...(d.changes.length ? d.changes.map((c) => `  ${c.change.padEnd(9)} ${c.id}`) : ['  none']),
    '',
    'Budget:',
    ...(budget.length ? [table(budget)] : ['  no change']),
    '',
    'New findings:',
    d.newFindings.length ? findingLines(d.newFindings) : '  none',
    '',
    'Execution-affecting changes:',
    ...(d.execChanges.length ? d.execChanges.map((f) => `  ${f.severity} ${f.path ?? ''}  ${f.message}`) : ['  none']),
    '',
    `Resolved: ${d.resolvedFindings.length}`,
  ].join('\n');
}

export function renderDiff(d: DiffResult, format: 'text' | 'json'): string {
  if (format === 'text') return `${diffText(d)}\n`;
  const { base, head, ...rest } = d;
  return `${JSON.stringify({ version: 1, base: { root: base.root, ref: base.ref }, head: { root: head.root, ref: head.ref }, ...rest }, null, 2)}\n`;
}

export function renderScan(r: ScanResult, view: 'scan' | 'lint' | 'budget', format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(scanJson(r, view), null, 2)}\n`;
  return `${view === 'scan' ? scanText(r) : view === 'lint' ? findingLines(r.findings) : budgetText(r)}\n`;
}
