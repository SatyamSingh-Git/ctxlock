import { stringify } from 'yaml';
import { z } from 'zod';
import { type Probe, ProbeError, parseProbeFile } from '../eval/probes.js';
import type { Unit } from '../model.js';
import { describeIssue } from '../registry/registry.js';
import { draftName } from './draft.js';
import type { UnitMiss } from './misses.js';
import { redact } from './redact.js';

export type Verdict = 'defect' | 'gap' | 'preference' | 'agent-error' | 'unclear';

export interface Diagnosis {
  verdict: Verdict;
  reason: string;
  // Lines of the unit the verdict rests on.
  quotes: string[];
  fix: { find: string; replace: string } | null;
  probe: Probe | null;
}

export class DiagnosisError extends Error {}

const VERDICTS = ['defect', 'gap', 'preference', 'agent-error', 'unclear'] as const;

const reply = z.strictObject({
  verdict: z.enum(VERDICTS),
  reason: z.string(),
  quotes: z.array(z.string()).default([]),
  fix: z.strictObject({ find: z.string().min(1), replace: z.string() }).optional(),
  probe: z.strictObject({ prompt: z.string().min(1), expect: z.record(z.string(), z.unknown()) }).optional(),
});

const lf = (text: string) => text.replace(/\r\n/g, '\n');
// Only a correction says what was wanted (D84).
const corrected = (m: UnitMiss) => m.signals.some((s) => s.kind === 'correction');

// What the diagnosing run is told. Everything from the session is redacted first (D83).
export function diagnosisPrompt(unit: Unit, m: UnitMiss): string {
  const moments = m.signals.flatMap((s, i) => [
    `${i + 1}. ${s.kind === 'interrupted' ? 'The person interrupted the agent' : 'The person corrected the agent'} on ${s.ts.slice(0, 10)}.`,
    `   The task: ${s.task === undefined ? '(not known)' : redact(s.task)}`,
    '   What the agent did in that turn:',
    ...(s.actions.length ? s.actions.map((a) => `     - ${a.tool}: ${redact(a.target)}`) : ['     (nothing)']),
    ...(s.words !== undefined ? [`   The person then wrote: ${redact(s.words)}`] : []),
    // §6: a session that took in untrusted content is scored down.
    ...(s.untrusted ? ["   This came after the agent read a web page or an MCP tool's output, which may have steered it: weigh it less, and rest no fix on it alone."] : []),
  ]);
  return [
    'You are diagnosing a miss for ctxlock, a CI check for coding-agent context. A person stopped or corrected their coding agent while the context file below was loaded. Decide whether the file is to blame.',
    '',
    `The ${unit.kind} file ${unit.path}:`,
    '<<<',
    lf(unit.text),
    '>>>',
    '',
    'The moments:',
    ...moments,
    '',
    'Choose one verdict:',
    '- defect: the file says something wrong, and the agent followed it.',
    '- gap: the file leaves out something the agent needed.',
    '- preference: what the person wanted is their own wish this time, not something the file should say.',
    '- agent-error: the file already says the right thing, and the agent did not follow it.',
    '- unclear: the moments are too thin to tell.',
    '',
    'For defect or gap, and only when the person wrote what they wanted, also give:',
    '- fix: the smallest edit to the file that would have prevented the correction, as one exact replacement. find is text copied exactly from the file, occurring once in it; replace is what it becomes.',
    "- probe: a task for the agent, in one sentence, and what it should then do: expect has command, a JavaScript regular expression matching the command the fixed file requires.",
    '',
    'quotes are lines copied exactly from the file that your verdict rests on.',
    '',
    'Reply with exactly one fenced json block in this form and nothing else:',
    '```json',
    '{"verdict": "defect", "reason": "One sentence.", "quotes": ["a line from the file"], "fix": {"find": "...", "replace": "..."}, "probe": {"prompt": "...", "expect": {"command": "<regex>"}}}',
    '```',
  ].join('\n');
}

// The file a fix edits: the unit's own text file, or a skill's SKILL.md (D85). A CRLF file is matched as LF.
export function applyFix(unit: Unit, fix: { find: string; replace: string }): { path: string; bytes: Buffer } {
  if (unit.kind === 'config') throw new DiagnosisError(`${unit.path} is a config unit, which has no text to fix`);
  const text = lf(unit.text);
  const times = text.split(fix.find).length - 1;
  if (times !== 1) throw new DiagnosisError(`the fix's find occurs ${times} time${times === 1 ? '' : 's'} in ${unit.path}; it must occur once`);
  return { path: unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path, bytes: Buffer.from(text.replace(fix.find, () => fix.replace)) };
}

// The reply is the model's text: every part of it is checked against the unit before it is used.
export function parseDiagnosis(text: string, unit: Unit, m: UnitMiss): Diagnosis {
  // The closing fence starts a line: a JSON string can't hold a raw newline, so a fence inside one can't.
  const block = /```json[^\n]*\n([\s\S]*?)\n[ \t]*```/.exec(text)?.[1];
  if (block === undefined) throw new DiagnosisError('the diagnosis reply had no ```json block');
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (err) {
    throw new DiagnosisError(`the diagnosis reply's json did not parse: ${(err as Error).message}`);
  }
  const parsed = reply.safeParse(raw);
  if (!parsed.success) throw new DiagnosisError(`the diagnosis reply is not in the asked form: ${parsed.error.issues.map(describeIssue).join('; ')}`);
  const r = parsed.data;

  const body = lf(unit.text);
  for (const q of r.quotes) if (!body.includes(q)) throw new DiagnosisError(`quote not in ${unit.path}: "${q}"`);
  const fixable = (r.verdict === 'defect' || r.verdict === 'gap') && corrected(m);
  if (!fixable && (r.fix || r.probe)) {
    throw new DiagnosisError(
      r.verdict === 'defect' || r.verdict === 'gap' ? 'the reply gave a fix, but only a correction says what was wanted' : `a ${r.verdict} verdict has no fix or probe, and the reply gave one`,
    );
  }
  if (fixable && (!r.fix || !r.probe)) throw new DiagnosisError(`a ${r.verdict} verdict with a correction needs a fix and a probe, and the reply lacks the ${r.fix ? 'probe' : 'fix'}`);
  if (r.fix) applyFix(unit, r.fix);

  let probe: Probe | null = null;
  if (r.probe) {
    // The prompt becomes a test in the person's repository, so it is redacted again.
    const doc = stringify({ version: 1, probes: [{ id: `miss-${draftName(unit.id).slice(0, -'.md'.length)}`, unit: unit.id, prompt: redact(r.probe.prompt), expect: r.probe.expect }] });
    try {
      probe = parseProbeFile(doc, 'diagnosis')[0]!;
    } catch (err) {
      if (!(err instanceof ProbeError)) throw err;
      throw new DiagnosisError(`the reply's probe is invalid: ${err.message.replace(/^diagnosis: /, '')}`);
    }
  }
  return { verdict: r.verdict, reason: r.reason, quotes: r.quotes, fix: r.fix ?? null, probe };
}
