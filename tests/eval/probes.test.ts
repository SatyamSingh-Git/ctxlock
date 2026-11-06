import { describe, expect, it } from 'vitest';
import type { Transcript } from '../../src/eval/claude.js';
import { ProbeError, grade, loadProbes, parseProbeFile } from '../../src/eval/probes.js';
import { memReader } from '../helpers/mem-reader.js';

const PNPM = `version: 1
probes:
  - id: deps-use-pnpm
    unit: instructions/AGENTS.md
    prompt: Add zod as a dependency.
    expect:
      command: '\\bpnpm\\s+add\\b'
`;
const QUIET = `version: 1
probes:
  - id: release-quiet
    unit: skill/.claude/skills/release
    prompt: What does handler.ts export?
    expect:
      skill: release
      not: true
`;

const errorOf = (files: Record<string, string>) =>
  loadProbes(memReader(files)).then(
    () => {
      throw new Error('expected a ProbeError');
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(ProbeError);
      return (e as Error).message;
    },
  );

const transcript = (t: Partial<Transcript>): Transcript => ({
  model: null, version: null, turns: 1, durationMs: 0, wallMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, utilization: null,
  commands: [], edits: [], skills: [], listedSkills: [], loads: [], denied: 0, outsideReads: 0, unhooked: 0, text: '', error: null, ...t,
});

describe('loadProbes', () => {
  it('reads every YAML file under evals/probes, in path order, deriving each kind', async () => {
    const probes = await loadProbes(memReader({ 'evals/probes/b.yml': QUIET, 'evals/probes/a/pnpm.yaml': PNPM, 'evals/other.yaml': PNPM, 'README.md': 'x' }));

    expect(probes.map((p) => [p.id, p.file, p.kind, p.not])).toEqual([
      ['deps-use-pnpm', 'evals/probes/a/pnpm.yaml', 'adherence', false],
      ['release-quiet', 'evals/probes/b.yml', 'trigger', true],
    ]);
    expect(probes[0]).toMatchObject({ unit: 'instructions/AGENTS.md', prompt: 'Add zod as a dependency.', expect: { command: '\\bpnpm\\s+add\\b' } });
  });

  it('hashes the definition, so the same probe in another file has the same hash and a new prompt a new one', async () => {
    const [a] = await loadProbes(memReader({ 'evals/probes/a.yaml': PNPM }));
    const [b] = await loadProbes(memReader({ 'evals/probes/b.yaml': PNPM }));
    const [c] = parseProbeFile(PNPM.replace('Add zod', 'Add lodash'), 'evals/probes/a.yaml');

    expect(a!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b!.hash).toBe(a!.hash);
    expect(c!.hash).not.toBe(a!.hash);
  });

  it('gives no probes without an evals/probes folder', async () => {
    expect(await loadProbes(memReader({ 'AGENTS.md': 'a' }))).toEqual([]);
  });

  it('names the file and the probe in every error', async () => {
    expect(await errorOf({ 'evals/probes/a.yaml': PNPM.replace("'\\bpnpm\\s+add\\b'", "'(('") })).toMatch(
      /^evals\/probes\/a\.yaml: probe deps-use-pnpm: invalid regular expression/,
    );
    expect(await errorOf({ 'evals/probes/a.yaml': PNPM, 'evals/probes/b.yaml': PNPM })).toMatch(
      /duplicate probe id deps-use-pnpm \(evals\/probes\/a\.yaml, evals\/probes\/b\.yaml\)/,
    );
    expect(await errorOf({ 'evals/probes/a.yaml': PNPM.replace('      command:', '      skill: x\n      command:') })).toMatch(
      /probe deps-use-pnpm: expect needs exactly one of command, edit, skill/,
    );
    expect(await errorOf({ 'evals/probes/a.yaml': PNPM.replace('prompt:', 'promt:') })).toMatch(/unknown key/);
    expect(await errorOf({ 'evals/probes/a.yaml': PNPM.replace('version: 1', 'version: 2') })).toMatch(/^evals\/probes\/a\.yaml: .*version/);
    expect(await errorOf({ 'evals/probes/a.yaml': 'version: 1\nprobes: [\n' })).toMatch(/^evals\/probes\/a\.yaml: /);
  });
});

describe('grade', () => {
  const [pnpm] = parseProbeFile(PNPM, 'p.yaml');
  const [quiet] = parseProbeFile(QUIET, 'q.yaml');
  const [edit] = parseProbeFile(PNPM.replace("command: '\\bpnpm\\s+add\\b'", () => "edit: '^package\\.json$'"), 'e.yaml');

  it('passes a command expectation when any intended command matches', () => {
    expect(grade(pnpm!, transcript({ commands: ['ls', 'cd x && pnpm add zod'] }))).toBe(true);
    expect(grade(pnpm!, transcript({ commands: ['npm install zod'] }))).toBe(false);
  });

  it('passes an edit expectation when any edited path matches', () => {
    expect(grade(edit!, transcript({ edits: ['package.json'] }))).toBe(true);
    expect(grade(edit!, transcript({ edits: ['src/package.json'] }))).toBe(false);
  });

  it('inverts with not: a should-not-trigger probe passes when the skill was not invoked', () => {
    expect(grade(quiet!, transcript({ skills: [] }))).toBe(true);
    expect(grade(quiet!, transcript({ skills: ['release'] }))).toBe(false);
  });
});
