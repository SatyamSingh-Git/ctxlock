import type { CheckResult } from '../check.js';
import type { Finding } from '../model.js';
import { printable, table } from './render.js';

const findingRows = (findings: Finding[]) => findings.map((f) => [`  ${f.rule}`, `${f.path ?? ''}${f.line ? `:${f.line}` : ''}`, f.message]);

// Everything shown comes from someone else's files, so every cell goes through printable.
function section(title: string, rows: string[][]): string[] {
  return rows.length === 0 ? [] : [`${title} (${rows.length}):`, table(rows.map((r) => r.map(printable))), ''];
}

export function renderCheck(r: CheckResult, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ version: 1, ...r }, null, 2)}\n`;
  const verdict =
    r.runs.length + r.must.length === 0
      ? 'Nothing here runs code when opened, and nothing must be fixed.'
      : `Review before opening: ${r.runs.length} ${r.runs.length === 1 ? 'thing runs' : 'things run'} code, ${r.must.length} must-fix.`;
  return [
    printable(r.read === r.target ? `ctxlock check ${r.target}` : `ctxlock check ${r.target} (${r.read})`),
    '',
    ...section('Runs code when opened', r.runs.map((i) => [`  ${i.agent}`, i.file, i.message])),
    ...section('Must fix', findingRows(r.must)),
    ...section('Worth a look', findingRows(r.worthALook)),
    verdict,
    '',
  ].join('\n');
}
