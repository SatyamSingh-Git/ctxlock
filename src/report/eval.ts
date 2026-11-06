import type { ArmResult, EvalResult, ProbeOutcome } from '../eval/eval.js';
import { cell, code } from './markdown.js';

// Counts, statuses, unit IDs and probe definitions only. What the agent tried or replied stays in
// the run folder: in a public repository a comment quoting it would carry out whatever it read.

const ratio = (a: ArmResult | null) => (a ? `${a.passed}/${a.valid}` : '—');
const label = (o: ProbeOutcome) => (o.status === 'not-run' ? 'not run' : o.status === 'regressed' ? '**regressed**' : o.status);
const pct = (u: number) => `${Math.round(u * 100)}%`;
const fixed = (i: [number, number] | null) => (i ? `${i[0].toFixed(2)}–${i[1].toFixed(2)}` : '—');

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function costLine(r: EvalResult): string {
  const t = r.totals;
  const parts = [`Cost: ${t.runs} runs (${t.cachedRuns} cached)`, duration(t.wallMs), `$${t.costUsd.toFixed(2)} notional on a subscription`];
  if (t.utilizationBefore !== null && t.utilizationAfter !== null) parts.push(`7-day usage window ${pct(t.utilizationBefore)} → ${pct(t.utilizationAfter)}`);
  return parts.join(' · ');
}

function notes(o: ProbeOutcome): string[] {
  const out: string[] = [];
  if (o.source === 'head') out.push('new in this pull request, so it never gates');
  if (o.changedInHead) out.push('this pull request edits the probe; the base version ran');
  return out;
}

const tokens = (n: number) => n.toLocaleString('en-US');

function tokenChange(o: ProbeOutcome): string | null {
  const b = o.base?.inputTokens;
  const h = o.head?.inputTokens;
  if (b == null || h == null) return null;
  const change = b === 0 ? 0 : ((h - b) / b) * 100;
  return `${tokens(b)} → ${tokens(h)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)`;
}

function seen(o: ProbeOutcome): string | null {
  if (!o.head || o.head.valid === 0) return null;
  const { observed, predicted } = o.head.targetLoaded;
  const loaded = `loaded in ${observed + predicted}/${o.head.valid} head runs`;
  return predicted > 0 ? `${loaded}, predicted: Claude Code reports no event for an AGENTS.md read without a CLAUDE.md` : loaded;
}

export function renderEval(r: EvalResult, format: 'text' | 'json' | 'markdown'): string {
  if (format === 'json') return `${JSON.stringify(r, null, 2)}\n`;
  const ran = r.outcomes.filter((o) => o.status !== 'not-run');
  const empty = r.changedUnits.length === 0 ? 'No context units changed, so no probe ran.' : 'No probe in `evals/probes/` covers the changed units.';
  const models = (o: ProbeOutcome) => {
    const [b, h] = [o.base?.models.join(', '), o.head?.models.join(', ')];
    return b && h && b !== h ? { b, h } : null;
  };

  if (format === 'text') {
    const lines = [`ctxlock eval · Claude Code ${r.claudeVersion ?? '—'} · model ${r.model ?? '—'} · ${r.runsPerArm} runs per arm`, ''];
    if (r.outcomes.length === 0) lines.push(empty);
    for (const o of r.outcomes) {
      lines.push(`  ${o.probe.id}  ${o.probe.unit}  base ${ratio(o.base)}  head ${ratio(o.head)}  ${o.status === 'not-run' ? 'not run' : o.status}${o.reason ? ` (${o.reason})` : ''}`);
      for (const n of notes(o)) lines.push(`    ${n}`);
      for (const e of [...(o.base?.errors ?? []).map((x) => `base: ${x}`), ...(o.head?.errors ?? []).map((x) => `head: ${x}`)]) lines.push(`    error, ${e}`);
    }
    if (r.stripped.length > 0) lines.push('', `Removed from the copies before running: ${r.stripped.join(', ')}`);
    if (r.headProbeErrors.length > 0) lines.push('', `Probe files in this pull request that could not be used: ${r.headProbeErrors.join('; ')}`);
    if (r.gateFailures.length > 0) lines.push('', `Gated regressions: ${r.gateFailures.join(', ')}`);
    lines.push('', costLine(r));
    return `${lines.join('\n')}\n`;
  }

  const lines = ['### ctxlock · behavioral check', '', `Claude Code ${code(r.claudeVersion ?? '—')} · model ${code(r.model ?? '—')} · ${r.runsPerArm} runs per arm`, ''];
  if (r.outcomes.length === 0) lines.push(empty);
  else {
    lines.push(
      '| Probe | Unit | Base | Head | Result |',
      '|---|---|---|---|---|',
      ...r.outcomes.map((o) => `| ${cell(code(o.probe.id))} | ${cell(code(o.probe.unit))} | ${ratio(o.base)} | ${ratio(o.head)} | ${[label(o), ...notes(o)].join(' · ')} |`),
    );
  }

  const block = (title: string, items: string[]) => {
    if (items.length > 0) lines.push('', `**${title}**`, '', ...items.map((i) => `- ${i}`));
  };
  if (ran.length > 0) {
    lines.push('', `95% intervals (Wilson): ${ran.map((o) => `${code(o.probe.id)} base ${fixed(o.base?.interval ?? null)}, head ${fixed(o.head?.interval ?? null)}`).join('; ')}`);
  }
  block('Did the agent see the change?', ran.flatMap((o) => (seen(o) ? [`${code(o.probe.id)}: ${code(o.probe.unit)} ${seen(o)}`] : [])));
  block('Input tokens per run (median, base → head)', ran.flatMap((o) => (tokenChange(o) ? [`${code(o.probe.id)} ${tokenChange(o)}`] : [])));
  block('Models', ran.flatMap((o) => (models(o) ? [`${code(o.probe.id)}: the base ran on ${code(models(o)!.b)}, the head on ${code(models(o)!.h)}`] : [])));
  block('Errors', ran.flatMap((o) => [...(o.base?.errors ?? []).map((e) => `${code(o.probe.id)} base: ${code(e)}`), ...(o.head?.errors ?? []).map((e) => `${code(o.probe.id)} head: ${code(e)}`)]));
  block('Not run', r.outcomes.filter((o) => o.reason).map((o) => `${code(o.probe.id)}: ${o.reason}`));
  block("This pull request's probe files could not be used; the base's probes ran", r.headProbeErrors.map(code));
  if (r.stripped.length > 0) lines.push('', `Removed from the copies before running, so no hook or server from the repository ran: ${r.stripped.map(code).join(', ')}`);

  lines.push('', costLine(r), '', '---', '', '_Advisory. Probes ran on Claude Code only; Codex is predicted statically._');
  return `${lines.join('\n')}\n`;
}
