import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ObservedLoad, Transcript } from '../../src/eval/claude.js';
import { joinLoads } from '../../src/eval/loads.js';
import { fsReader } from '../../src/repo/reader.js';
import { scanRepo } from '../../src/scan.js';
import { cleanup, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const digestOf = (path: string, content: string) => `sha256:${sha(`${path}\0${sha(content)}\n`)}`;

const transcript = (t: Partial<Transcript>): Transcript => ({
  model: null, version: null, turns: 1, durationMs: 0, wallMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, utilization: null,
  commands: [], edits: [], skills: [], listedSkills: [], loads: [], denied: 0, outsideReads: 0, unhooked: 0, text: '', error: null, ...t,
});

async function setup(files: Record<string, string>) {
  const dir = tempDir();
  writeTree(dir, files);
  return { dir, scan: await scanRepo(fsReader(dir)) };
}

const RULE = '---\npaths: ["packages/api/**"]\n---\nAPI rule\n';

describe('joinLoads', () => {
  it('turns observed loads into context.load records with the unit and its digest', async () => {
    const { dir, scan } = await setup({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'Use pnpm.\n', '.claude/rules/api.md': RULE, 'packages/api/CLAUDE.md': 'api\n', 'packages/api/h.ts': 'x' });
    const loads: ObservedLoad[] = [
      { path: 'CLAUDE.md', reason: 'session_start' },
      { path: 'AGENTS.md', reason: 'include', parent: 'CLAUDE.md' },
      { path: '.claude/rules/api.md', reason: 'path_glob_match', trigger: 'packages/api/h.ts' },
      { path: 'packages/api/CLAUDE.md', reason: 'nested_traversal', trigger: 'packages/api/h.ts' },
      { path: 'CLAUDE.md', reason: 'compact' },
    ];

    expect(joinLoads(transcript({ loads }), scan, dir)).toEqual([
      { unit_id: 'instructions/CLAUDE.md', unit_digest: digestOf('CLAUDE.md', '@AGENTS.md\n'), load_reason: 'session_start', observed: true },
      { unit_id: 'instructions/AGENTS.md', unit_digest: digestOf('AGENTS.md', 'Use pnpm.\n'), load_reason: 'import', observed: true },
      { unit_id: 'rule/.claude/rules/api.md', unit_digest: digestOf('.claude/rules/api.md', RULE), load_reason: 'glob', trigger_file: 'packages/api/h.ts', observed: true },
      { unit_id: 'instructions/packages/api/CLAUDE.md', unit_digest: digestOf('packages/api/CLAUDE.md', 'api\n'), load_reason: 'nested', trigger_file: 'packages/api/h.ts', observed: true },
      { unit_id: 'instructions/CLAUDE.md', unit_digest: digestOf('CLAUDE.md', '@AGENTS.md\n'), load_reason: 'compact', observed: true },
    ]);
  });

  it('gives a null digest when the bytes loaded differ from the scanned unit', async () => {
    const { dir, scan } = await setup({ 'CLAUDE.md': 'scanned\n' });
    writeTree(dir, { 'CLAUDE.md': 'changed after the scan\n' });

    expect(joinLoads(transcript({ loads: [{ path: 'CLAUDE.md', reason: 'session_start' }] }), scan, dir)).toEqual([
      { unit_id: 'instructions/CLAUDE.md', unit_digest: null, load_reason: 'session_start', observed: true },
    ]);
  });

  it('ignores loads of files that are no unit, and of paths outside the copy', async () => {
    const { dir, scan } = await setup({ 'CLAUDE.md': 'c\n', 'notes.md': 'n' });
    const loads = [{ path: 'notes.md', reason: 'session_start' }, { path: '/elsewhere/CLAUDE.md', reason: 'session_start' }];

    expect(joinLoads(transcript({ loads }), scan, dir)).toEqual([]);
  });

  it('records skills listed at launch and skills invoked, but not built-in ones or skills Claude Code did not list', async () => {
    const skill = '---\nname: release\ndescription: Publish a version.\n---\nSteps.\n';
    const { dir, scan } = await setup({
      'CLAUDE.md': 'c\n',
      '.claude/skills/release/SKILL.md': skill,
      '.claude/skills/other/SKILL.md': '---\nname: other\ndescription: Not listed in this run.\n---\nx\n',
      // Below the root, so not in the launch listing, though it shares a built-in skill's name.
      'pkg/.claude/skills/simplify/SKILL.md': '---\nname: simplify\ndescription: A nested skill.\n---\nx\n',
    });
    const digest = `sha256:${sha(`.claude/skills/release/SKILL.md\0${sha(skill)}\n`)}`;

    expect(joinLoads(transcript({ listedSkills: ['release', 'simplify'], skills: ['release'] }), scan, dir)).toEqual([
      { unit_id: 'skill/.claude/skills/release', unit_digest: digest, load_reason: 'skill_listed', observed: true },
      { unit_id: 'skill/.claude/skills/release', unit_digest: digest, load_reason: 'skill_invoked', observed: true },
    ]);
  });

  it('predicts an AGENTS.md read through the fallback, which Claude Code never reports (D37)', async () => {
    const only = await setup({ 'AGENTS.md': 'Use pnpm.\n@sub/AGENTS.md\n', 'sub/AGENTS.md': 'sub\n' });
    expect(joinLoads(transcript({}), only.scan, only.dir)).toEqual([
      { unit_id: 'instructions/AGENTS.md', unit_digest: digestOf('AGENTS.md', 'Use pnpm.\n@sub/AGENTS.md\n'), load_reason: 'session_start', observed: false },
      { unit_id: 'instructions/sub/AGENTS.md', unit_digest: digestOf('sub/AGENTS.md', 'sub\n'), load_reason: 'import', observed: false },
    ]);

    const seen = transcript({ loads: [{ path: 'sub/AGENTS.md', reason: 'include', parent: 'AGENTS.md' }] });
    expect(joinLoads(seen, only.scan, only.dir).map((r) => [r.unit_id, r.observed])).toEqual([
      ['instructions/sub/AGENTS.md', true],
      ['instructions/AGENTS.md', false],
    ]);

    const shadowed = await setup({ 'CLAUDE.md': 'c\n', 'AGENTS.md': 'a\n' });
    expect(joinLoads(transcript({}), shadowed.scan, shadowed.dir)).toEqual([]);
  });
});
