import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runClaude } from '../../src/eval/claude.js';
import { type ArmResult, type EvalResult, runEval } from '../../src/eval/eval.js';
import type { Probe } from '../../src/eval/probes.js';
import { renderEval } from '../../src/report/eval.js';
import { cleanup, gitRepo, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const PNPM = '\\bpnpm\\s+add\\b';
const probe = (id: string): Probe => ({
  id, file: 'evals/probes/p.yaml', unit: 'instructions/AGENTS.md', prompt: 'Add zod as a dependency.', expect: { command: PNPM }, not: false, kind: 'adherence', hash: 'h',
});
const arm = (passed: number, valid: number, interval: [number, number], extra: Partial<ArmResult> = {}): ArmResult => ({
  passed, valid, errors: [], cached: 0, interval, models: ['claude-sonnet-5-5'], inputTokens: 1000, turns: 2, durationMs: 1200, costUsd: 0.13,
  targetLoaded: { observed: 0, predicted: valid }, ...extra,
});
const result = (extra: Partial<EvalResult> = {}): EvalResult => ({
  harness: 'claude-code', model: 'claude-sonnet-5-5', claudeVersion: '2.1.292', runsPerArm: 3, changedUnits: ['instructions/AGENTS.md'],
  outcomes: [
    { probe: probe('deps'), source: 'base', changedInHead: false, base: arm(0, 3, [0, 0.5615]), head: arm(3, 3, [0.4385, 1], { inputTokens: 1010 }), status: 'improved' },
    { probe: probe('b'), source: 'base', changedInHead: false, base: null, head: null, status: 'not-run', reason: 'run budget (6 runs)' },
  ],
  stripped: ['.claude/settings.json'], gateFailures: [], headProbeErrors: [],
  totals: { runs: 6, cachedRuns: 0, wallMs: 72_000, costUsd: 0.26, utilizationBefore: 0.57, utilizationAfter: 0.57 },
  ...extra,
});

describe('renderEval markdown', () => {
  const md = renderEval(result(), 'markdown');

  it('opens with the section header, the agent, the model and the runs per arm', () => {
    expect(md.startsWith('### ctxlock · behavioral check\n\nClaude Code `2.1.292` · model `claude-sonnet-5-5` · 3 runs per arm\n')).toBe(true);
  });

  it('puts each probe in a table row', () => {
    expect(md).toContain(
      ['| Probe | Unit | Base | Head | Result |', '|---|---|---|---|---|', '| `deps` | `instructions/AGENTS.md` | 0/3 | 3/3 | improved |', '| `b` | `instructions/AGENTS.md` | — | — | not run |'].join('\n'),
    );
  });

  it('gives the 95% intervals, whether the agent saw the change, tokens, and what was not run', () => {
    expect(md).toContain('95% intervals (Wilson): `deps` base 0.00–0.56, head 0.44–1.00');
    expect(md).toContain('`deps`: `instructions/AGENTS.md` loaded in 3/3 head runs, predicted');
    expect(md).toContain('`deps` 1,000 → 1,010 (+1.0%)');
    expect(md).toContain('`b`: run budget (6 runs)');
    expect(md).toContain('`.claude/settings.json`');
  });

  it('ends with the cost line and the footer', () => {
    expect(md).toContain('Cost: 6 runs (0 cached) · 1m 12s · $0.26 notional on a subscription · 7-day usage window 57% → 57%');
    expect(md.endsWith('_Advisory. Probes ran on Claude Code only; Codex is predicted statically._\n')).toBe(true);
  });

  it('names both models when the arms ran on different ones', () => {
    const [deps] = result().outcomes;
    const mixed = renderEval(result({ outcomes: [{ ...deps!, base: { ...deps!.base!, models: ['claude-sonnet-5-0'] } }] }), 'markdown');
    expect(mixed).toContain('`deps`: the base ran on `claude-sonnet-5-0`, the head on `claude-sonnet-5-5`');
  });

  it('shows repository text as code, so a probe id cannot mention anyone', () => {
    const [deps] = result().outcomes;
    const hostile = renderEval(result({ outcomes: [{ ...deps!, probe: probe('@octocat|x') }] }), 'markdown');
    expect(hostile).toContain('| `@octocat\\|x` |');
  });

  it("lists the pull request's probe files that could not be used, as code", () => {
    const md = renderEval(result({ headProbeErrors: ['evals/probes/zz.yaml: version: Invalid input: expected 1'] }), 'markdown');
    expect(md).toContain("**This pull request's probe files could not be used; the base's probes ran**");
    expect(md).toContain('- `evals/probes/zz.yaml: version: Invalid input: expected 1`');
    expect(renderEval(result({ headProbeErrors: ['evals/probes/zz.yaml: bad'] }), 'text')).toContain('Probe files in this pull request that could not be used: evals/probes/zz.yaml: bad');
  });

  it('says why nothing ran', () => {
    expect(renderEval(result({ outcomes: [], changedUnits: [] }), 'markdown')).toContain('No context units changed, so no probe ran.');
    expect(renderEval(result({ outcomes: [] }), 'markdown')).toContain('No probe in `evals/probes/` covers the changed units.');
  });
});

describe('renderEval text and json', () => {
  it('text lists each probe with both arms and the cost', () => {
    const text = renderEval(result(), 'text');
    expect(text).toMatch(/deps\s+instructions\/AGENTS\.md\s+base 0\/3\s+head 3\/3\s+improved/);
    expect(text).toContain('Cost: 6 runs (0 cached) · 1m 12s · $0.26 notional on a subscription · 7-day usage window 57% → 57%');
  });

  it('json is the result itself', () => {
    expect(JSON.parse(renderEval(result(), 'json'))).toEqual(result());
  });
});

describe('no agent text in any output', { timeout: 120_000 }, () => {
  it('a canary the agent ran and replied with reaches the transcript but no rendering', async () => {
    const fake = resolve('tests/helpers/fake-claude.mjs');
    const scenario = join(tempDir(), 'scenario.json');
    writeFileSync(scenario, JSON.stringify({ behaviours: [{ calls: [{ tool: 'Bash', input: { command: 'echo CANARY-7f3a' } }] }], text: 'CANARY-reply' }));
    process.env.FAKE_CLAUDE_SCENARIO = scenario;

    const dir = join(tempDir(), 'arm');
    mkdirSync(dir);
    const t = await runClaude({ dir, scratch: join(tempDir(), 's'), prompt: 'p', model: 'sonnet', claude: [fake] });
    expect(t.commands).toEqual(['echo CANARY-7f3a']);
    expect(t.text).toBe('CANARY-reply');

    const { dir: root } = await gitRepo([{ 'AGENTS.md': 'Use npm.\n', 'evals/probes/p.yaml': `version: 1\nprobes:\n  - id: deps\n    unit: instructions/AGENTS.md\n    prompt: Add zod.\n    expect:\n      command: '${PNPM}'\n` }]);
    writeTree(root, { 'AGENTS.md': 'Use pnpm.\n' });
    const r = await runEval({ root, base: 'HEAD', runs: 2, maxRuns: 24, maxMinutes: 20, model: 'sonnet', claude: [fake], ctxlockVersion: '0.1.0', workdir: join(tempDir(), 'w'), cacheDir: null, all: false, keepRuns: false });
    expect(r.outcomes).toHaveLength(1);
    for (const format of ['text', 'json', 'markdown'] as const) {
      expect(renderEval(r, format)).not.toMatch(/CANARY/);
    }
  });
});
