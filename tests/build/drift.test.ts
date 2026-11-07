import { describe, expect, it } from 'vitest';
import { findDrift } from '../../src/build/drift.js';
import { GENERATED_FILE, serializeGenerated } from '../../src/build/generated.js';
import { BuildError, suggestIndex } from '../../src/build/index-suggest.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';

const drift = async (files: Record<string, string>) => findDrift(await scanRepo(memReader(files), { today: '2026-11-07' }));
const SKILL = '---\nname: release\ndescription: Releases\n---\nRun it.\n';

describe('findDrift', () => {
  it('reports two hand-made copies of a skill that differ, naming the files that differ', async () => {
    expect(
      await drift({
        '.agents/skills/release/SKILL.md': SKILL,
        '.agents/skills/release/notes.md': 'n',
        '.claude/skills/release/SKILL.md': SKILL.replace('Run it.', 'Run it twice.'),
        '.claude/skills/release/notes.md': 'n',
      }),
    ).toEqual([{ paths: ['.agents/skills/release', '.claude/skills/release'], summary: 'the copies differ: SKILL.md' }]);
  });

  it('reports nothing for identical copies, or for a copy ctxlock generated', async () => {
    expect(await drift({ '.agents/skills/release/SKILL.md': SKILL, '.claude/skills/release/SKILL.md': SKILL })).toEqual([]);
    const record = serializeGenerated([{ path: '.claude/skills/release/SKILL.md', sha256: lfDigest(Buffer.from('old')), from: [{ path: '.agents/skills/release/SKILL.md', sha256: lfDigest(Buffer.from('old')) }] }]);
    expect(await drift({ '.agents/skills/release/SKILL.md': SKILL, '.claude/skills/release/SKILL.md': 'old', [GENERATED_FILE]: record })).toEqual([]);
  });

  it('passes over a skill with files reached through a symlink, which it cannot pair by path', async () => {
    const reader = memReader(
      { '.agents/skills/release/SKILL.md': SKILL, '.claude/skills/release/SKILL.md': SKILL, 'tools/a/run.sh': 'a', 'tools/b/run.sh': 'b' },
      { '.agents/skills/release/scripts': 'tools/a', '.claude/skills/release/scripts': 'tools/b' },
    );
    expect(findDrift(await scanRepo(reader, { today: '2026-11-07' }))).toEqual([]);
  });

  it('reports a CLAUDE.md and an AGENTS.md beside it that differ, unless CLAUDE.md imports it', async () => {
    expect(await drift({ 'CLAUDE.md': 'Use pnpm.\nRun tests.\n\nClaude only.\n', 'AGENTS.md': 'Use pnpm.\nRun tests.\nUse npm for scripts.\n' })).toEqual([
      { paths: ['CLAUDE.md', 'AGENTS.md'], summary: '1 line only in CLAUDE.md, 1 only in AGENTS.md' },
    ]);
    expect(await drift({ 'CLAUDE.md': '@AGENTS.md\nClaude only.\n', 'AGENTS.md': 'Use pnpm.\n' })).toEqual([]);
    expect(await drift({ 'pkg/.claude/CLAUDE.md': '@../AGENTS.md\n', 'pkg/AGENTS.md': 'Use pnpm.\n' })).toEqual([]);
    expect(await drift({ 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.md': 'Use pnpm.\n' })).toEqual([]);
  });
});

describe('suggestIndex', () => {
  it("writes the index in the format of Next.js's agents-md codemod: header, root, the retrieval line, then folder:{files}", async () => {
    const reader = memReader({ 'docs/a.md': '', 'docs/guide/c.mdx': '', 'docs/guide/b.md': '', 'docs/img.png': '', 'other/x.md': '' });
    const r = await suggestIndex(reader, 'docs');

    expect(r.text).toBe('[docs index]|root: ./docs|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|.:{a.md}|guide:{b.md,c.mdx}');
    expect(r.bytes).toBe(Buffer.byteLength(r.text));
  });

  it('sorts the folders, and indexes the whole repository for an empty path', async () => {
    const r = await suggestIndex(memReader({ 'README.md': '', 'docs/z.md': '', 'docs/a/y.md': '' }), 'docs');
    expect(r.text).toBe('[docs index]|root: ./docs|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|.:{z.md}|a:{y.md}');

    const all = await suggestIndex(memReader({ 'README.md': '', 'docs/z.md': '' }), '');
    expect(all.text).toBe('[. index]|root: .|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|.:{README.md}|docs:{z.md}');
  });

  it('says so when the folder has no markdown', async () => {
    await expect(suggestIndex(memReader({ 'docs/img.png': '' }), 'docs')).rejects.toThrow(new BuildError('no markdown files under docs'));
  });
});
