import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { Unit } from '../model.js';
import { fsReader } from '../repo/reader.js';
import { scanRepo } from '../scan.js';
import { runClaude } from './claude.js';
import { type Probe, ProbeError, grade, parseProbeFile } from './probes.js';
import { ancestorContext, changedSince, materialize, snapshot } from './workspace.js';

export interface DraftOptions {
  root: string;
  unit: string;
  count: number;
  runs: number;
  maxRuns: number;
  model: string;
  claude: string[];
  workdir: string;
  out?: string;
}

export interface DraftResult {
  // Repo-relative. Nothing is written there when no probe was kept.
  path: string;
  kept: string[];
  discarded: Array<{ id: string; reason: string }>;
  runs: number;
}

export class DraftError extends Error {}

const slug = (unit: Unit) =>
  unit.kind === 'skill' ? `skill-${unit.name}` : unit.path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const description = (unit: Unit) => (typeof unit.frontmatter?.description === 'string' ? unit.frontmatter.description : '');

function draftPrompt(unit: Unit, count: number): string {
  const intro = [
    'Draft test probes for ctxlock, a CI check for coding-agent context. A probe is a task a developer might give a coding agent in this repository, and a check on what the agent then tries to do.',
    '',
  ];
  const ask =
    unit.kind === 'skill'
      ? [
          `The unit under test is the skill "${unit.name}" (${unit.path}). Its description is: ${description(unit)}`,
          '',
          `Draft ${Math.ceil(count / 2)} probes whose task should make an agent invoke this skill, and ${Math.floor(count / 2)} whose task is about this repository but should not.`,
          `Each probe expects skill: ${unit.name}. A probe that should not invoke it also sets not: true under expect.`,
        ]
      : [
          `The unit under test is the ${unit.kind} file ${unit.path}:`,
          '<<<',
          unit.text,
          '>>>',
          '',
          `Draft ${count} probes. In each, following this file decides which shell command is right, and a capable agent that had not read the file would most likely run a different one: name a tool or command this file requires that the agent would not pick by default.`,
          "Each probe expects command: a JavaScript regular expression, in single quotes, that matches the command this file requires.",
        ];
  const format = ['', 'Reply with exactly one fenced yaml block in this form and nothing else:', '```yaml', 'probes:', '  - id: short-kebab-case-id', '    prompt: The task, in one sentence.', '    expect:', "      command: '<regex>'", '```'];
  return [...intro, ...ask, ...format].join('\n');
}

interface Candidate {
  id: string;
  probe: Probe | null;
  invalid?: string;
}

function candidates(text: string, unit: string): Candidate[] {
  const block = /```ya?ml[^\n]*\n([\s\S]*?)```/.exec(text)?.[1];
  if (block === undefined) throw new DraftError('the drafting reply had no ```yaml block');
  let raw: unknown;
  try {
    raw = parse(block, { schema: 'core' });
  } catch (err) {
    throw new DraftError(`the drafting reply's yaml did not parse: ${(err as Error).message}`);
  }
  const list = Array.isArray(raw) ? raw : (raw as { probes?: unknown } | null)?.probes;
  if (!Array.isArray(list)) throw new DraftError('the drafting reply had no list of probes');
  return list.map((item: Record<string, unknown>, i) => {
    const id = typeof item?.id === 'string' ? item.id : `candidate-${i + 1}`;
    // ctxlock decides which unit a probe tests; whatever the model wrote there is replaced.
    const doc = stringify({ version: 1, probes: [{ ...item, id, unit }] });
    try {
      return { id, probe: parseProbeFile(doc, 'draft')[0]! };
    } catch (err) {
      if (err instanceof ProbeError) return { id, probe: null, invalid: err.message.replace(/^draft: /, '') };
      throw err;
    }
  });
}

export async function draftProbes(opts: DraftOptions): Promise<DraftResult> {
  // Without the gitignored CLAUDE.local.md: the probes it keeps will run in CI, which never has it.
  const reader = fsReader(opts.root, { local: false });
  const scan = await scanRepo(reader);
  const unit = scan.units.find((u) => u.id === opts.unit);
  if (!unit) throw new DraftError(`no unit ${opts.unit} in ${opts.root}; ctxlock scan lists the units`);
  const path = opts.out ?? `evals/probes/${slug(unit)}.yaml`;
  if (existsSync(join(opts.root, path))) throw new DraftError(`${path} already exists; pass --out to write somewhere else`);

  mkdirSync(opts.workdir, { recursive: true });
  const runRoot = mkdtempSync(join(opts.workdir, 'ctxlock-draft-'));
  const arms = { with: join(runRoot, 'with'), without: join(runRoot, 'without') };
  try {
    for (const dir of Object.values(arms)) {
      const [found] = ancestorContext(dir);
      if (found) throw new DraftError(`${found} is above the run folder and would load into every run; pass --workdir <a folder outside it>`);
    }
    let n = 0;
    const scratch = () => join(runRoot, 'scratch', String(++n));
    const draftDir = join(runRoot, 'draft');
    mkdirSync(draftDir);
    const drafted = await runClaude({ dir: draftDir, scratch: scratch(), prompt: draftPrompt(unit, opts.count), model: opts.model, claude: opts.claude, tools: [] });
    if (drafted.error) throw new DraftError(`the drafting run failed: ${drafted.error}`);
    const found = candidates(drafted.text, unit.id);

    await materialize(reader, arms.with);
    await materialize(reader, arms.without);
    // The without arm is the same copy with the unit gone, wherever links had made it appear.
    for (const p of [unit.path, ...unit.aliases]) rmSync(join(arms.without, p), { recursive: true, force: true });
    const before = { with: snapshot(arms.with), without: snapshot(arms.without) };

    let runs = 0;
    const kept: Probe[] = [];
    const discarded: DraftResult['discarded'] = [];
    for (const c of found) {
      if (!c.probe) {
        discarded.push({ id: c.id, reason: `invalid: ${c.invalid}` });
        continue;
      }
      const probe = c.probe;
      const armNames = probe.kind === 'adherence' ? (['with', 'without'] as const) : (['with'] as const);
      if (runs + armNames.length * opts.runs > opts.maxRuns) {
        discarded.push({ id: c.id, reason: 'run budget' });
        continue;
      }
      const results = { with: [] as boolean[], without: [] as boolean[] };
      const errors: string[] = [];
      for (let i = 0; i < opts.runs; i++) {
        for (const arm of armNames) {
          const t = await runClaude({ dir: arms[arm], scratch: scratch(), prompt: probe.prompt, model: opts.model, claude: opts.claude });
          runs++;
          if (t.unhooked > 0) throw new DraftError(`${t.error}; stopping before anything else runs`);
          const changed = changedSince(arms[arm], before[arm]);
          if (changed.length > 0) throw new DraftError(`a run changed ${changed.length} file${changed.length === 1 ? '' : 's'} in the copy behind the hooks; stopping before anything else runs`);
          if (t.error) errors.push(t.error);
          else results[arm].push(grade(probe, t));
        }
      }
      if (results.with.length === 0) discarded.push({ id: c.id, reason: `runs failed: ${errors[0]}` });
      else if (!results.with.every(Boolean)) discarded.push({ id: c.id, reason: 'fails with the unit' });
      else if (results.without.some(Boolean)) discarded.push({ id: c.id, reason: 'passes without the unit too (D36)' });
      else kept.push(probe);
    }

    if (kept.length > 0) {
      const file = join(opts.root, path);
      mkdirSync(dirname(file), { recursive: true });
      const probes = kept.map((p) => ({ id: p.id, unit: p.unit, prompt: p.prompt, expect: p.not ? { ...p.expect, not: true } : p.expect }));
      writeFileSync(file, `# Drafted by ctxlock probe draft from ${unit.id} (${unit.digest}). Review before committing.\n${stringify({ version: 1, probes })}`);
    }
    return { path, kept: kept.map((p) => p.id), discarded, runs: runs + 1 };
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}
