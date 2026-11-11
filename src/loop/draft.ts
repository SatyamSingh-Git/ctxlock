import { code } from '../report/markdown.js';
import { lfDigest } from '../units/digest.js';
import type { UnitMiss } from './misses.js';
import { redact } from './redact.js';

// The first line of every draft, with the digest of what follows it. A file in the drafts folder without
// it is someone's own, and one whose text no longer matches was edited since: both stay as they are.
const MARK = /^<!-- ctxlock:miss (\S+) (\S+) -->\r?\n/;

export function draftState(text: string, id: string): 'unedited' | 'edited' | 'other' {
  const mark = MARK.exec(text);
  if (!mark || mark[1] !== id) return 'other';
  return lfDigest(Buffer.from(text.slice(mark[0].length))) === mark[2] ? 'unedited' : 'edited';
}

export const draftName = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, '-')}.md`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A fence longer than any backtick run inside, so the text can't end it and nothing in it renders.
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

// repo is where the unit belongs: this repository's name, or the upstream's repository for a synced unit.
export function renderDraft(m: UnitMiss, repo: string, excerpts: boolean): string {
  const bySession = new Map<string, boolean>();
  for (const s of m.signals) bySession.set(s.session, (bySession.get(s.session) ?? false) || !s.untrusted);
  const half = [...bySession.values()].filter((trusted) => !trusted).length;
  const kinds = [m.kinds.interrupted ? `${m.kinds.interrupted} interrupted` : '', m.kinds.correction ? plural(m.kinds.correction, 'correction') : ''].filter(Boolean);
  const [first, last] = [m.first.slice(0, 10), m.last.slice(0, 10)];

  const lines = [
    `# ctxlock: ${code(m.id)} was in play when the agent was stopped or corrected`,
    '',
    `- **Belongs in:** ${code(repo)}${m.upstream ? `, the upstream ${code(m.upstream.name)} this repository syncs it from` : ''}`,
    `- **Owners:** ${m.owners.length ? m.owners.join(', ') : 'none in ctxlock.yaml or CODEOWNERS'}`,
    `- **Sessions:** ${m.sessions}, of ${m.loadedIn} that loaded it${half ? `; ${half} counted at half, since it had read web or MCP content first` : ''}`,
    `- **Signals:** ${kinds.join(', ')}, ${first === last ? `on ${first}` : `from ${first} to ${last}`}${m.inTurn ? `; ${m.inTurn} came in the turn it loaded` : ''}`,
    `- **Digest today:** ${code(m.digest)}${m.olderVersion ? `; ${m.olderVersion} of these sessions loaded other bytes` : ''}`,
    ...(m.everySession ? ['', "It loaded in every session, so exposure alone can't single it out."] : []),
  ];
  const said = m.signals.filter((s) => s.words !== undefined);
  if (excerpts && said.length) {
    lines.push('', '## What was typed');
    for (const s of said) lines.push('', `${s.ts.slice(0, 10)}:`, '', fenced(redact(s.words!)));
  }
  lines.push(
    '',
    'These are signals, not a diagnosis: the unit was in context when the agent was stopped or corrected. Check whether it says something wrong, leaves something out, or was not followed.',
  );
  const body = `${lines.join('\n')}\n`;
  return `<!-- ctxlock:miss ${m.id} ${lfDigest(Buffer.from(body))} -->\n${body}`;
}
