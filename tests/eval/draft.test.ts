import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DraftError, type DraftOptions, draftProbes } from '../../src/eval/draft.js';
import { parseProbeFile } from '../../src/eval/probes.js';
import { cleanup, gitRepo, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const FAKE = resolve('tests/helpers/fake-claude.mjs');
let argvLog: string;

const reply = (yaml: string) => `Here are the probes.\n\n\`\`\`yaml\n${yaml}\`\`\`\n`;
const CANDIDATES = reply(`probes:
  - id: deps-use-pnpm
    prompt: Add zod as a dependency.
    expect:
      command: '\\bpnpm\\s+add\\b'
  - id: lint-with-ruff
    prompt: Lint the Python code.
    expect:
      command: '\\bruff\\b'
`);

function scenario(draftText: string, extra: Record<string, unknown> = {}, validation?: unknown[]) {
  const file = join(tempDir(), 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      counterFile: join(tempDir(), 'counter'),
      behaviours: [
        { when: { promptContains: 'Draft' }, calls: [], text: draftText },
        ...(validation ?? [
          { when: { file: 'AGENTS.md', contains: 'pnpm' }, calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' } }, { tool: 'Bash', input: { command: 'ruff check .' } }] },
          { calls: [{ tool: 'Bash', input: { command: 'npm install zod' } }, { tool: 'Bash', input: { command: 'ruff check .' } }] },
        ]),
      ],
      ...extra,
    }),
  );
  process.env.FAKE_CLAUDE_SCENARIO = file;
}

beforeEach(() => {
  argvLog = join(tempDir(), 'argv.jsonl');
  process.env.FAKE_CLAUDE_ARGV_LOG = argvLog;
});

async function repo(files: Record<string, string> = { 'AGENTS.md': 'Use pnpm for every package command.\n' }) {
  const { dir } = await gitRepo([files]);
  return dir;
}

const options = (root: string, extra: Partial<DraftOptions> = {}): DraftOptions => ({
  root, unit: 'instructions/AGENTS.md', count: 2, runs: 2, maxRuns: 24, model: 'sonnet', claude: [FAKE], workdir: join(tempDir(), 'work'), ...extra,
});

describe('draftProbes', { timeout: 120_000 }, () => {
  it('writes only the probes that tell the arms apart', async () => {
    scenario(CANDIDATES);
    const root = await repo();

    const r = await draftProbes(options(root));

    expect(r).toEqual({ path: 'evals/probes/agents-md.yaml', kept: ['deps-use-pnpm'], discarded: [{ id: 'lint-with-ruff', reason: 'passes without the unit too (D36)' }], runs: 1 + 2 * 2 * 2 });
    const text = readFileSync(join(root, r.path), 'utf8');
    expect(text.startsWith('# Drafted by ctxlock probe draft from instructions/AGENTS.md (sha256:')).toBe(true);
    expect(parseProbeFile(text, r.path).map((p) => [p.id, p.unit, p.expect])).toEqual([['deps-use-pnpm', 'instructions/AGENTS.md', { command: '\\bpnpm\\s+add\\b' }]]);
  });

  it('drafts with every tool switched off, from a prompt that holds the unit text', async () => {
    scenario(CANDIDATES);
    await draftProbes(options(await repo()));

    const [first] = readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.includes('"-p"')).map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
    expect(first!.argv[first!.argv.indexOf('--tools') + 1]).toBe('');
    expect(first!.prompt).toContain('Use pnpm for every package command.');
  });

  it('sets each probe unit itself, whatever the model wrote', async () => {
    scenario(reply("probes:\n  - id: deps-use-pnpm\n    unit: rule/elsewhere.md\n    prompt: Add zod as a dependency.\n    expect:\n      command: '\\bpnpm\\s+add\\b'\n"));
    const root = await repo();

    const r = await draftProbes(options(root));

    expect(parseProbeFile(readFileSync(join(root, r.path), 'utf8'), r.path)[0]!.unit).toBe('instructions/AGENTS.md');
  });

  it('refuses to write over an existing probe file, and leaves it as it was', async () => {
    scenario(CANDIDATES);
    const root = await repo();
    writeTree(root, { 'evals/probes/agents-md.yaml': 'mine\n' });

    await expect(draftProbes(options(root))).rejects.toThrow(DraftError);
    expect(readFileSync(join(root, 'evals/probes/agents-md.yaml'), 'utf8')).toBe('mine\n');
  });

  it('stops, writing nothing, when a validation run got past the run hook', async () => {
    scenario(CANDIDATES, {}, [{ calls: [{ tool: 'Bash', input: { command: 'pnpm add zod' }, unhooked: true }] }]);
    const root = await repo();

    await expect(draftProbes(options(root))).rejects.toThrow(/^1 tool call reached Claude Code without passing the run hook; stopping/);
    expect(existsSync(join(root, 'evals/probes/agents-md.yaml'))).toBe(false);
  });

  it('stops when a validation run changes the copy, without naming what it wrote', async () => {
    scenario(CANDIDATES, { touch: 'CANARY-NAME.txt' });
    const root = await repo();

    const failure = draftProbes(options(root));
    await expect(failure).rejects.toThrow(/^a run changed 1 file in the copy behind the hooks; stopping/);
    await expect(failure).rejects.not.toThrow(/CANARY/);
    expect(existsSync(join(root, 'evals/probes/agents-md.yaml'))).toBe(false);
  });

  it('says so when the reply has no yaml block, and discards an invalid candidate with its reason', async () => {
    scenario('I could not think of any.');
    await expect(draftProbes(options(await repo()))).rejects.toThrow(/no ```yaml block/);

    scenario(reply("probes:\n  - id: broken\n    prompt: Add zod.\n    expect:\n      command: '(('\n"));
    const root = await repo();
    const r = await draftProbes(options(root));
    expect(r.kept).toEqual([]);
    expect(r.discarded).toEqual([{ id: 'broken', reason: expect.stringMatching(/^invalid: .*invalid regular expression/) }]);
    expect(existsSync(join(root, r.path))).toBe(false);
  });

  it('keeps a should-trigger probe only if every run invoked the skill', async () => {
    const skill = '---\nname: release\ndescription: Publish a new version of this project.\n---\nSteps.\n';
    scenario(
      reply('probes:\n  - id: release-triggers\n    prompt: Publish a new version.\n    expect:\n      skill: release\n'),
      {},
      [{ when: { oddRun: true }, calls: [{ tool: 'Skill', input: { skill: 'release' } }] }, { calls: [] }],
    );
    const root = await repo({ 'CLAUDE.md': 'c\n', '.claude/skills/release/SKILL.md': skill });

    const r = await draftProbes(options(root, { unit: 'skill/.claude/skills/release' }));

    expect(r.path).toBe('evals/probes/skill-release.yaml');
    expect(r.discarded).toEqual([{ id: 'release-triggers', reason: 'fails with the unit' }]);
    expect(r.runs).toBe(1 + 2);
  });
});
