import type { ConsumerUse, Impact, Use, WhoUses } from '../graph/graph.js';
import { cell, code } from './markdown.js';
import { table } from './render.js';

// A unit's ID is its kind, a slash, then its path.
const pathOf = (id: string) => id.slice(id.indexOf('/') + 1);
const through = (via: string[]) => (via.length ? `through ${via.map(pathOf).join(', ')}` : '');
const block = (title: string, rows: string[][]) => (rows.length ? ['', `${title}:`, table(rows.map(([first, ...rest]) => [`  ${first}`, ...rest]))] : []);
const unitRows = (uses: Use[]) => uses.map((u) => [pathOf(u.id), through(u.via)]);
const consumerRows = (consumers: ConsumerUse[]) => consumers.map((c) => [c.name, c.owner ?? '', c.maturity, through(c.via)]);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function renderWhoUses(w: WhoUses, format: 'text' | 'json'): string {
  if (format === 'json') return json(w);
  const lines = [
    `ctxlock who-uses · ${pathOf(w.id)}`,
    ...(w.units.length + w.consumers.length === 0
      ? ['', 'Nothing in ctxlock.yaml depends on it.']
      : [...block('Units that depend on it', unitRows(w.units)), ...block('Consumers', consumerRows(w.consumers))]),
    ...(w.loads.length ? block('Loaded by (predicted)', w.loads.map((l) => [l.harness, l.site || '.', l.mode])) : ['', 'No configured agent loads it.']),
    ...block('Generated from it', w.generated.map((path) => [path])),
  ];
  return `${lines.join('\n')}\n`;
}

const viaCodes = (via: string[]) => via.map((id) => cell(code(pathOf(id)))).join(', ');

// What a change reaches, as markdown: repository text is code, so no owner is notified.
function reachedMarkdown(i: Impact): string[] {
  return [
    ...(i.dependents.length
      ? ['', '| Depends on what changed | Through |', '|---|---|', ...i.dependents.map((u) => `| ${cell(code(pathOf(u.id)))} | ${viaCodes(u.via)} |`)]
      : []),
    ...(i.consumers.length
      ? [
          '',
          '| Consumer | Owner | Maturity | Through |',
          '|---|---|---|---|',
          ...i.consumers.map((c) => `| ${cell(code(c.name))} | ${c.owner ? cell(code(c.owner)) : ''} | ${c.maturity} | ${viaCodes(c.via)} |`),
        ]
      : []),
    ...(i.owners.length ? ['', `Owners to ask: ${i.owners.map(code).join(', ')}`] : []),
  ];
}

function reachedText(i: Impact): string[] {
  return [
    ...block('Depends on what changed', unitRows(i.dependents)),
    ...block('Consumers', consumerRows(i.consumers)),
    ...(i.owners.length ? ['', `Owners to ask: ${i.owners.join(', ')}`] : []),
  ];
}

export function renderImpact(i: Impact, format: 'text' | 'json' | 'markdown'): string {
  if (format === 'json') return json(i);
  if (format === 'markdown') {
    const lines = ['### ctxlock · impact', '', '#### Changed units', ''];
    if (i.changed.length === 0) lines.push('No context units changed.');
    else lines.push('| Unit | Change |', '|---|---|', ...i.changed.map((c) => `| ${cell(code(pathOf(c.id)))} | ${c.change} |`));
    const reached = reachedMarkdown(i);
    if (reached.length) lines.push('', '#### Impact', ...reached);
    return `${lines.join('\n')}\n`;
  }
  const lines = [
    'ctxlock impact',
    ...(i.changed.length ? block('Changed', i.changed.map((c) => [pathOf(c.id), c.change])) : ['', 'No context units changed.']),
    ...reachedText(i),
  ];
  return `${lines.join('\n')}\n`;
}
