import type { DiffResult } from '../diff.js';
import type { Finding } from '../model.js';
import { impactSection } from './graph.js';

// Repository text is always shown as code: as markdown it could notify GitHub users (@name), hide
// itself (<!-- -->), or load images and links into the pull request.
// Repository text, as an inline code span: no @mention, HTML or image in it can render. A line
// break would end the span (a blank line) or the table row, so each becomes a space.
export function code(text: string): string {
  const s = text.replace(/\r\n|\r|\n/g, ' ');
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return longest > 0 ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
}

export const cell = (s: string) => s.replaceAll('|', '\\|');
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function item(f: Finding): string {
  if (f.path === undefined) return `- ${code(f.message)}`;
  return `- ${code(f.line ? `${f.path}:${f.line}` : f.path)} — ${code(f.message)}`;
}

export function renderErrorMarkdown(message: string): string {
  return `### ctxlock · context check\n\nctxlock could not run: ${code(message)}\n`;
}

export function renderDiffMarkdown(d: DiffResult): string {
  const blocking = [...d.newFindings, ...d.execChanges].filter((f) => f.severity === 'must').length;
  const lines = ['### ctxlock · context check', '', blocking > 0 ? `❌ ${blocking} must-fix` : '✅ no must-fix issues'];
  if (d.existingMust > 0) lines.push('', `${plural(d.existingMust, 'must finding')} already on the base branch ${d.existingMust === 1 ? 'is' : 'are'} not counted here.`);

  lines.push('', '#### Changed units', '');
  if (d.changes.length === 0) lines.push('No context units changed.');
  else lines.push('| Unit | Change |', '|---|---|', ...d.changes.map((c) => `| ${cell(code(c.id))} | ${c.change} |`));
  lines.push(...impactSection(d.impact, 'markdown'));

  lines.push('', '#### Budget', '');
  if (d.budget.length === 0) lines.push('No change in what agents load at the start of a session.');
  else {
    lines.push(
      '| Harness | Site | Before → after (bytes) | Limit |',
      '|---|---|---|---|',
      ...d.budget.map((r) => `| ${r.harness} | ${cell(code(r.site || '.'))} | ${r.baseAlwaysBytes} → ${r.alwaysBytes} | ${r.limitBytes ?? '—'} |`),
    );
  }

  lines.push('', '#### New findings', '');
  if (d.newFindings.length === 0) lines.push('None.');
  for (const [severity, title] of [['must', 'Must fix'], ['should', 'Should fix'], ['info', 'Info']] as const) {
    const group = d.newFindings.filter((f) => f.severity === severity);
    if (group.length > 0) lines.push(`**${title}**`, '', ...group.map(item), '');
  }
  if (lines.at(-1) === '') lines.pop();

  lines.push('', '#### Execution-affecting changes', '');
  lines.push(...(d.execChanges.length === 0 ? ['None.'] : d.execChanges.map(item)));

  lines.push('', `Resolved: ${plural(d.resolvedFindings.length, 'finding')} no longer present.`);
  return `${lines.join('\n')}\n`;
}
