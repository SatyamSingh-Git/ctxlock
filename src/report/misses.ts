import type { Misses, UnitMiss } from '../loop/misses.js';
import { block, sessions } from './graph.js';
import { INSTALL } from './loads.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const rows = (units: UnitMiss[]) =>
  units.map((u) => [
    u.id,
    sessions(u.sessions),
    `loaded in ${u.loadedIn}`,
    u.upstream ? `from ${u.upstream.name}` : u.owners.length ? `owner ${u.owners.join(', ')}` : '',
    u.routed ? 'routed' : '',
  ]);

// A person's words appear only with --excerpts (D82).
export function renderMisses(m: Misses, format: 'text' | 'json', excerpts: boolean): string {
  if (format === 'json') return `${JSON.stringify(m, (key, value) => (key === 'words' && !excerpts ? undefined : value), 2)}\n`;
  if (m.sessions === 0) return `${['ctxlock misses · no Claude Code sessions recorded for this repository', '', ...INSTALL].join('\n')}\n`;

  const lines = [`ctxlock misses · ${sessions(m.sessions)}, ${m.withTranscript} with a transcript${m.since ? ` · since ${m.since}` : ''}`, ''];
  const total = m.signals.interrupted + m.signals.correction;
  if (total === 0) return `${[...lines, 'Signals: none'].join('\n')}\n`;

  const kinds = [m.signals.interrupted ? `${m.signals.interrupted} interrupted` : '', m.signals.correction ? plural(m.signals.correction, 'correction') : ''].filter(Boolean);
  lines.push(`Signals: ${kinds.join(' · ')}, in ${sessions(m.withSignal)}${m.untrusted ? ` · ${m.untrusted} after web or MCP content, counted at half` : ''}`);
  lines.push(...block('Units in the turn when the agent was stopped or corrected', rows(m.units.filter((u) => !u.everySession))));
  lines.push(...block("In every session, so exposure can't single them out", rows(m.units.filter((u) => u.everySession))));
  if (excerpts) {
    const said = new Map(m.units.flatMap((u) => u.signals).filter((s) => s.words !== undefined).map((s) => [`${s.session} ${s.ts}`, s]));
    lines.push(...block('Corrections', [...said.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1)).map((s) => [s.ts.slice(0, 10), s.words!])));
  }

  const footer = [
    ...(m.unattributed ? [`No load in the turn: ${plural(m.unattributed, 'signal')}`] : []),
    ...(m.units.length === 0
      ? []
      : m.units.some((u) => u.routed)
        ? [`Routed at ${sessions(m.minSessions)} or more: ${plural(m.units.filter((u) => u.routed).length, 'unit')}. Write drafts with --drafts <folder>.`]
        : [`None reached ${sessions(m.minSessions)}, so nothing is routed.`]),
  ];
  if (footer.length) lines.push('', ...footer);
  return `${lines.join('\n')}\n`;
}
