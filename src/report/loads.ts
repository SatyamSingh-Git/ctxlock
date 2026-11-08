import type { Sessions } from '../collect/sessions.js';
import { block, howLoaded, sessions } from './graph.js';

const NONE = 'ctxlock loads · no Claude Code sessions recorded for this repository';
const INSTALL = [
  'The collector records which units Claude Code loads in your sessions. To install it:',
  '  claude plugin marketplace add SatyamSingh-Git/ctxlock',
  '  claude plugin install ctxlock@ctxlock',
];

export function renderLoads(s: Sessions, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(s, null, 2)}\n`;
  const from = s.first?.slice(0, 10);
  const to = s.last?.slice(0, 10);
  const lines =
    s.sessions === 0
      ? [
          NONE,
          '',
          ...(s.elsewhere
            ? [`The collector has recorded ${sessions(s.elsewhere)}, none in this repository. A session counts here when Claude Code starts in it or loads a file from it.`]
            : INSTALL),
        ]
      : [
          `ctxlock loads · ${sessions(s.sessions, 'Claude Code ')}, ${from === to ? from : `${from} to ${to}`}`,
          ...block('Loaded', s.units.map((u) => [u.path, sessions(u.sessions), ...howLoaded(u)])),
          ...block('Not loaded in these sessions', s.unseen.map((u) => [u.path, u.mode])),
          ...(s.undeclared ? ['', 'These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.'] : []),
        ];
  const problems = [
    ...(s.errors.last ? [`Collector errors, from every repository: ${s.errors.count}. The last, on ${s.errors.last.ts.slice(0, 10)}: ${s.errors.last.message}`] : []),
    ...(s.skipped ? [`Lines not read, from every repository: ${s.skipped}`] : []),
  ];
  if (problems.length) lines.push('', ...problems);
  return `${lines.join('\n')}\n`;
}
