import { stringify } from 'yaml';
import type { ArmResult, ProbeOutcome } from '../eval/eval.js';
import type { Expectation, Probe } from '../eval/probes.js';
import { fenced, marked } from '../loop/draft.js';
import type { Proposal } from '../loop/propose.js';
import { sessions } from './graph.js';
import { code, plural } from './markdown.js';
import { printable, table } from './render.js';

const NO_FIX: Record<string, string> = {
  'agent-error': 'the unit already says the right thing, and the agent did not follow it.',
  preference: 'what was wanted was a one-off preference, not something the unit should say.',
  unclear: 'the moments are too thin to tell.',
};
const noFix = (p: Proposal) => NO_FIX[p.diagnosis.verdict] ?? 'only a correction says what was wanted.';
const CERTIFIED = "This unit is certified: the fix needs its owner's approval.";

const expectation = (probe: Probe) => {
  const [kind, pattern] = Object.entries(probe.expect as Expectation)[0]!;
  return `${probe.not ? 'not ' : ''}${kind} /${pattern}/`;
};
const passes = (side: string, a: ArmResult | null) => (a ? `${side} ${a.passed}/${a.valid}` : `${side} -`);
const signals = (p: Proposal) =>
  [p.unit.kinds.interrupted ? `${p.unit.kinds.interrupted} interrupted` : '', p.unit.kinds.correction ? plural(p.unit.kinds.correction, 'correction') : ''].filter(Boolean).join(', ');
const lines = (prefix: string, text: string) => text.split('\n').map((l) => `${prefix}${l}`);
const older = (p: Proposal) => `${p.unit.olderVersion} of these sessions loaded other bytes than the unit has today; the fix is to the unit as it is now.`;

// The model wrote the reason, quotes, fix and probe: every one of them is printed through printable.
export function renderDiagnosis(p: Proposal, format: 'text' | 'json'): string {
  const d = p.diagnosis;
  if (format === 'json') {
    const json = { unit: p.unit.id, verdict: d.verdict, reason: d.reason, quotes: d.quotes, fix: d.fix, probe: d.probe && { id: d.probe.id, prompt: d.probe.prompt, expect: d.probe.expect }, tier: p.tier, replay: p.replay, runs: p.runs };
    return `${JSON.stringify(json, null, 2)}\n`;
  }
  const out = [`ctxlock diagnose · ${p.unit.id} · ${sessions(p.unit.sessions)}, ${signals(p)}`, '', `Verdict: ${d.verdict}`, `  ${printable(d.reason)}`];
  if (d.quotes.length) out.push('', 'Rests on:', ...d.quotes.map((q) => `  ${printable(q)}`));
  if (!d.fix || !d.probe) out.push('', `No fix: ${noFix(p)}`);
  else {
    out.push('', 'Fix:', ...lines('  - ', printable(d.fix.find)), ...lines('  + ', printable(d.fix.replace)));
    out.push('', `Probe ${printable(d.probe.id)}:`, `  prompt  ${printable(d.probe.prompt)}`, `  expect  ${printable(expectation(d.probe))}`);
  }
  if (p.replay) {
    const row = (o: ProbeOutcome, role: string) => [`  ${printable(o.probe.id)}`, role, passes('base', o.base), passes('head', o.head), o.status];
    out.push('', `Replay, ${p.replay.runsPerArm} runs a side: ${p.replay.status}`, table([row(p.replay.miss, 'the miss'), ...p.replay.others.map((o) => row(o, 'existing'))]));
  }
  const notes = [...(p.unit.olderVersion ? [older(p)] : []), ...(p.tier === 'certified' ? [CERTIFIED] : [])];
  if (notes.length) out.push('', ...notes);
  out.push('', `Runs: ${p.runs}`);
  return `${out.join('\n')}\n`;
}

// The proposal file, and the issue body (D87): the diagnosis, the fix, the probe and the replay; no
// text from the session. What the model wrote sits in code, so it can't mention anyone or render.
export function renderProposal(p: Proposal, repo: string): string {
  const d = p.diagnosis;
  const out = [
    `# ctxlock: a proposed fix for ${code(p.unit.id)}`,
    '',
    `- **Belongs in:** ${code(repo)}`,
    `- **Verdict:** ${d.verdict}`,
    `- **Why:** ${code(printable(d.reason))}`,
    `- **Signals:** ${signals(p)}, in ${sessions(p.unit.sessions)}`,
    ...d.quotes.map((q) => `- **Rests on:** ${code(printable(q))}`),
  ];
  if (!d.fix || !d.probe) out.push('', `No fix: ${noFix(p)}`);
  else {
    const diff = [...lines('- ', printable(d.fix.find)), ...lines('+ ', printable(d.fix.replace))].join('\n');
    const probe = stringify({ version: 1, probes: [{ id: d.probe.id, unit: d.probe.unit, prompt: printable(d.probe.prompt), expect: d.probe.not ? { ...d.probe.expect, not: true } : d.probe.expect }] }).trimEnd();
    out.push('', '## The fix', '', fenced(diff, 'diff'), '', '## The probe', '', `It fails without the fix and passes with it. Commit it under \`evals/probes/\` with the fix.`, '', fenced(probe, 'yaml'));
  }
  if (p.replay) {
    const said = (o: ProbeOutcome) => `${code(o.probe.id)}: ${passes('base', o.base)}, ${passes('head', o.head)}, ${o.status}`;
    out.push('', `- **Replay:** ${p.replay.status}, ${p.replay.runsPerArm} runs a side`, `  - the miss, ${said(p.replay.miss)}`, ...p.replay.others.map((o) => `  - ${said(o)}`));
  }
  if (p.unit.olderVersion) out.push('', older(p));
  if (p.tier === 'certified') out.push('', CERTIFIED);
  out.push('', 'Proposed by ctxlock diagnose. Nothing was changed in the repository.');
  return marked('fix', p.unit.id, `${out.join('\n')}\n`);
}
