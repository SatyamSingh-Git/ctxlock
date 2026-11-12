import { describe, expect, it } from 'vitest';
import type { ArmResult, ProbeOutcome } from '../../src/eval/eval.js';
import { parseProbeFile } from '../../src/eval/probes.js';
import { draftState } from '../../src/loop/draft.js';
import type { UnitMiss } from '../../src/loop/misses.js';
import type { Proposal } from '../../src/loop/propose.js';
import { renderDiagnosis, renderProposal } from '../../src/report/diagnose.js';

const ID = 'rule/.claude/rules/deps.md';
const arm = (passed: number, valid = 2): ArmResult => ({
  passed, valid, errors: [], cached: 0, interval: null, models: [], inputTokens: null, turns: null, durationMs: null, costUsd: 0, targetLoaded: { observed: 0, predicted: 0 },
});
const [miss, other] = parseProbeFile(
  `version: 1\nprobes:\n  - id: miss-deps\n    unit: ${ID}\n    prompt: Add the dayjs package.\n    expect:\n      command: 'pnpm add'\n  - id: deps-dayjs\n    unit: ${ID}\n    prompt: Use dayjs.\n    expect:\n      command: 'dayjs'\n`,
  'x.yaml',
);
const outcome = (probe: typeof miss, base: number, head: number, status: ProbeOutcome['status']): ProbeOutcome => ({ probe: probe!, source: 'head', changedInHead: false, selectedFor: 'the miss', base: arm(base), head: arm(head), status });
const UNIT = { id: ID, sessions: 2, kinds: { interrupted: 1, correction: 1 }, olderVersion: 1, signals: [] } as unknown as UnitMiss;
const CONTROL = String.fromCodePoint(0x1b);

const PROPOSAL: Proposal = {
  unit: UNIT,
  tier: 'certified',
  runs: 9,
  diagnosis: {
    verdict: 'defect',
    reason: `The rule says npm${CONTROL}[2J, and the person uses pnpm.`,
    quotes: ['Install packages with npm install.'],
    fix: { find: 'Install packages with npm install.', replace: 'Install packages with pnpm add.' },
    probe: miss!,
  },
  replay: { status: 'validated', runsPerArm: 2, miss: outcome(miss, 0, 2, 'improved'), others: [{ ...outcome(other, 2, 2, 'unchanged'), source: 'base', selectedFor: 'changed' }] },
};

describe('renderDiagnosis', () => {
  it('text gives the verdict, the quotes, the fix as a diff, the probe and the replay, with control characters replaced', () => {
    const text = renderDiagnosis(PROPOSAL, 'text');

    expect(text).toContain('ctxlock diagnose · rule/.claude/rules/deps.md · 2 sessions, 1 interrupted, 1 correction\n');
    expect(text).toContain('\nVerdict: defect\n  The rule says npm?[2J, and the person uses pnpm.\n');
    expect(text).toContain('\nRests on:\n  Install packages with npm install.\n');
    expect(text).toContain('\nFix:\n  - Install packages with npm install.\n  + Install packages with pnpm add.\n');
    expect(text).toContain('\nProbe miss-deps:\n  prompt  Add the dayjs package.\n  expect  command /pnpm add/\n');
    expect(text).toContain('\nReplay, 2 runs a side: validated\n  miss-deps   the miss  base 0/2  head 2/2  improved\n  deps-dayjs  existing  base 2/2  head 2/2  unchanged\n');
    expect(text).toContain('\n1 of these sessions loaded other bytes than the unit has today; the fix is to the unit as it is now.\n');
    expect(text).toContain('\nThis unit is certified: the fix needs its owner\'s approval.\n');
    expect(text).toContain('\nRuns: 9\n');
    expect(text).not.toContain(CONTROL);
  });

  it('says why there is no fix, and json carries the whole proposal', () => {
    const agent = renderDiagnosis({ ...PROPOSAL, tier: 'reviewed', diagnosis: { ...PROPOSAL.diagnosis, verdict: 'agent-error', fix: null, probe: null }, replay: null }, 'text');
    expect(agent).toContain('\nNo fix: the unit already says the right thing, and the agent did not follow it.\n');
    expect(agent).not.toContain('certified');
    const stopped = renderDiagnosis({ ...PROPOSAL, diagnosis: { ...PROPOSAL.diagnosis, fix: null, probe: null }, replay: null }, 'text');
    expect(stopped).toContain('\nNo fix: only a correction says what was wanted.\n');

    expect(JSON.parse(renderDiagnosis(PROPOSAL, 'json'))).toMatchObject({ unit: ID, verdict: 'defect', tier: 'certified', replay: { status: 'validated' }, runs: 9 });
    // An inverted probe stays inverted, as the proposal's YAML has it.
    const inverted = { ...PROPOSAL, diagnosis: { ...PROPOSAL.diagnosis, probe: { ...miss!, not: true } } };
    expect(JSON.parse(renderDiagnosis(inverted, 'json')).probe).toEqual({ id: 'miss-deps', prompt: 'Add the dayjs package.', expect: { command: 'pnpm add' }, not: true });
    expect(JSON.parse(renderDiagnosis(PROPOSAL, 'json')).probe.not).toBe(false);
  });
});

describe('renderProposal', () => {
  it("is marked as the unit's fix proposal, holds the diagnosis and replay, and no session text", () => {
    const body = renderProposal(PROPOSAL, 'https://github.com/acme/web.git');

    expect(draftState(body, ID, 'fix')).toBe('unedited');
    expect(draftState(body, ID, 'miss')).toBe('other');
    expect(body).toContain('- **Belongs in:** `https://github.com/acme/web.git`');
    expect(body).toContain('- **Verdict:** defect');
    expect(body).toContain('```diff\n- Install packages with npm install.\n+ Install packages with pnpm add.\n```');
    expect(body).toContain('- **Replay:** validated');
    expect(body).toContain("This unit is certified: the fix needs its owner's approval.");
    expect(body).not.toContain(CONTROL);
    expect(body).toContain('It fails without the fix and passes with it.');
  });

  it('says the probe and fix are not shown to work when the replay did not validate them', () => {
    const replay = (status: 'not-validated' | 'inconclusive') => renderProposal({ ...PROPOSAL, replay: { ...PROPOSAL.replay!, status } }, 'acme/web');

    expect(replay('not-validated')).not.toContain('passes with it');
    expect(replay('not-validated')).toContain('The replay did not validate the fix, so neither it nor the probe is ready to commit as it is.');
    expect(replay('inconclusive')).not.toContain('passes with it');
    expect(replay('inconclusive')).toContain('The replay was cut short, so whether the fix works is not known. Run it again with more --max-runs or --max-minutes.');
  });

  it('says how many signals came after web or MCP content, in the text, the json and the proposal', () => {
    const SAYS = "1 of the 2 signals came after the agent read a web page or an MCP tool's output, which may have steered it.";
    const signals = [{ untrusted: true }, { untrusted: false }] as UnitMiss['signals'];
    const p = { ...PROPOSAL, unit: { ...UNIT, signals } };

    expect(renderDiagnosis(p, 'text')).toContain(`\n${SAYS}\n`);
    expect(renderProposal(p, 'acme/web')).toContain(`\n${SAYS}\n`);
    expect(JSON.parse(renderDiagnosis(p, 'json')).untrusted).toBe(1);
    const trusted = { ...PROPOSAL, unit: { ...UNIT, signals: [{ untrusted: false }] as UnitMiss['signals'] } };
    expect(renderDiagnosis(trusted, 'text')).not.toContain('web page');
    expect(renderProposal(trusted, 'acme/web')).not.toContain('web page');
  });

  it('a fix that adds lines keeps them as lines, in the text, the diff and the issue', () => {
    const fix = { find: '## Setup', replace: `## Setup\n\tUse pnpm.${CONTROL}` };
    const p = { ...PROPOSAL, diagnosis: { ...PROPOSAL.diagnosis, fix } };

    expect(renderDiagnosis(p, 'text')).toContain('\nFix:\n  - ## Setup\n  + ## Setup\n  + \tUse pnpm.?\n');
    expect(renderProposal(p, 'acme/web')).toContain('```diff\n- ## Setup\n+ ## Setup\n+ \tUse pnpm.?\n```');
  });
});
