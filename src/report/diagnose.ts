import { stringify } from 'yaml';
import type { ArmResult, ProbeOutcome } from '../eval/eval.js';
import type { Expectation, Probe } from '../eval/probes.js';
import { fenced, marked } from '../loop/draft.js';
import { looksWorse, type Proposal, type Replay } from '../loop/propose.js';
import { sessions } from './graph.js';
import { code, plural } from './markdown.js';
import { kindsText } from './misses.js';
import { printable, table } from './render.js';

const NO_FIX: Record<string, string> = {
  'agent-error': 'the unit already says the right thing, and the agent did not follow it.',
  preference: 'what was wanted was a one-off preference, not something the unit should say.',
  unclear: 'the moments are too thin to tell.',
};
const noFix = (p: Proposal) => NO_FIX[p.diagnosis.verdict] ?? 'only a correction says what was wanted.';
// D98: what taking the unit out did to the miss's probe.
const ABLATION: Partial<Record<ProbeOutcome['status'], string>> = {
  improved: 'Taking it out does what was wanted: the unit itself causes the miss.',
  unchanged: 'Taking it out changes nothing: the unit does not drive the miss.',
  regressed: 'Taking it out makes it worse: the unit helps.',
  uncertain: 'Not known: taking it out looks different, but not by enough runs to show it. Run again with more --runs.',
};
function ablated(a: ProbeOutcome): string {
  // A miss that didn't happen with the unit in place can't be blamed on it or cleared by its removal.
  if (a.status === 'unchanged' && a.base && a.base.passed * 2 >= a.base.valid) return "The miss didn't happen with the unit in place, so taking it out says nothing about the unit.";
  return ABLATION[a.status] ?? `Not known: ${a.reason ? `cut short by the ${a.reason}` : 'fewer than 2 runs a side finished without an error'}.`;
}
const CERTIFIED = "This unit is certified: the fix needs its owner's approval.";

const expectation = (probe: Probe) => {
  const [kind, pattern] = Object.entries(probe.expect as Expectation)[0]!;
  return `${probe.not ? 'not ' : ''}${kind} /${pattern}/`;
};
const passes = (side: string, a: ArmResult | null) => (a ? `${side} ${a.passed}/${a.valid}` : `${side} -`);
const signals = (p: Proposal) => kindsText(p.unit.kinds);
// Split before printable, which would turn the newlines and tabs of a fix into ?.
const lines = (prefix: string, text: string) => text.split('\n').map((l) => `${prefix}${l.split('\t').map(printable).join('\t')}`);
const PROBE_SAYS: Record<Replay['status'], string> = {
  validated: 'It fails without the fix and passes with it. Commit it under `evals/probes/` with the fix.',
  'not-validated': 'The replay did not validate the fix, so neither it nor the probe is ready to commit as it is.',
  inconclusive: 'The replay was cut short, so whether the fix works is not known. Run it again with more --max-runs or --max-minutes.',
};
function probeSays(replay: Replay | null): string {
  if (replay?.miss.status === 'uncertain' && replay.miss.reason?.startsWith('not extended')) {
    return `The replay looks better with the fix, but not by enough runs to show it, and --extend did not fit in the ${replay.miss.reason.slice('not extended: '.length)}. Run again with more --max-runs.`;
  }
  if (replay?.miss.status === 'uncertain') return 'The replay looks better with the fix, but not by enough runs to show it, so whether the fix works is not known. Run again with more --runs or --extend.';
  if (replay?.others.some(looksWorse)) {
    return "One of the unit's own probes looks worse with the fix, but not by enough runs to show it, so whether the fix is safe is not known. Run again with more --runs or --extend.";
  }
  return PROBE_SAYS[replay?.status ?? 'inconclusive'];
}
const verdict = (o: ProbeOutcome) => (o.reason ? `${o.status} (${o.reason})` : o.status);
const untrusted = (p: Proposal) => p.unit.signals.filter((s) => s.untrusted).length;
const steered = (p: Proposal) =>
  untrusted(p) ? [`${untrusted(p)} of the ${plural(p.unit.signals.length, 'signal')} came after the agent read a web page or an MCP tool's output, which may have steered it.`] : [];
const older = (p: Proposal) => `${p.unit.olderVersion} of these sessions loaded other bytes than the unit has today; the fix is to the unit as it is now.`;

// The model wrote the reason, quotes, fix and probe: every one of them is printed through printable.
export function renderDiagnosis(p: Proposal, format: 'text' | 'json'): string {
  const d = p.diagnosis;
  if (format === 'json') {
    const json = { unit: p.unit.id, untrusted: untrusted(p), verdict: d.verdict, reason: d.reason, quotes: d.quotes, fix: d.fix, probe: d.probe && { id: d.probe.id, prompt: d.probe.prompt, expect: d.probe.expect, not: d.probe.not }, tier: p.tier, replay: p.replay, runs: p.runs };
    return `${JSON.stringify(json, null, 2)}\n`;
  }
  const out = [`ctxlock diagnose · ${p.unit.id} · ${sessions(p.unit.sessions)}, ${signals(p)}`, '', `Verdict: ${d.verdict}`, `  ${printable(d.reason)}`];
  if (d.quotes.length) out.push('', 'Rests on:', ...d.quotes.map((q) => `  ${printable(q)}`));
  if (!d.fix || !d.probe) out.push('', `No fix: ${noFix(p)}`);
  else {
    out.push('', 'Fix:', ...lines('  - ', d.fix.find), ...lines('  + ', d.fix.replace));
    out.push('', `Probe ${printable(d.probe.id)}:`, `  prompt  ${printable(d.probe.prompt)}`, `  expect  ${printable(expectation(d.probe))}`);
  }
  if (p.replay) {
    const row = (o: ProbeOutcome, role: string) => [`  ${printable(o.probe.id)}`, role, passes('base', o.base), passes('head', o.head), verdict(o)];
    out.push('', `Replay, ${p.replay.runsPerArm} runs a side: ${p.replay.status}`, table([row(p.replay.miss, 'the miss'), ...p.replay.others.map((o) => row(o, 'existing'))]));
    const a = p.replay.ablation;
    if (a && 'skipped' in a) out.push('', `Without the unit: not run, as ${a.skipped}.`);
    else if (a) out.push('', `Without the unit, ${p.replay.runsPerArm} runs a side: ${a.status}`, table([[`  ${printable(a.probe.id)}`, passes('base', a.base), passes('without', a.head), a.status]]), ablated(a));
  }
  const notes = [...steered(p), ...(p.unit.olderVersion ? [older(p)] : []), ...(p.tier === 'certified' ? [CERTIFIED] : [])];
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
    const diff = [...lines('- ', d.fix.find), ...lines('+ ', d.fix.replace)].join('\n');
    const probe = stringify({ version: 1, probes: [{ id: d.probe.id, unit: d.probe.unit, prompt: printable(d.probe.prompt), expect: d.probe.not ? { ...d.probe.expect, not: true } : d.probe.expect }] }).trimEnd();
    out.push('', '## The fix', '', fenced(diff, 'diff'), '', '## The probe', '', probeSays(p.replay), '', fenced(probe, 'yaml'));
  }
  if (p.replay) {
    const said = (o: ProbeOutcome) => `${code(o.probe.id)}: ${passes('base', o.base)}, ${passes('head', o.head)}, ${verdict(o)}`;
    out.push('', `- **Replay:** ${p.replay.status}, ${p.replay.runsPerArm} runs a side`, `  - the miss, ${said(p.replay.miss)}`, ...p.replay.others.map((o) => `  - ${said(o)}`));
    const a = p.replay.ablation;
    if (a && 'skipped' in a) out.push(`- **Without the unit:** not run, as ${a.skipped}.`);
    else if (a) out.push(`- **Without the unit:** ${a.status}, ${passes('base', a.base)}, ${passes('without', a.head)}. ${ablated(a)}`);
  }
  for (const note of steered(p)) out.push('', note);
  if (p.unit.olderVersion) out.push('', older(p));
  if (p.tier === 'certified') out.push('', CERTIFIED);
  out.push('', 'Proposed by ctxlock diagnose. Nothing was changed in the repository.');
  return marked('fix', p.unit.id, `${out.join('\n')}\n`);
}
