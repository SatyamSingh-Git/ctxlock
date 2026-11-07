import { existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyFill } from '../../src/build/apply.js';
import { GENERATED_FILE, loadGenerated } from '../../src/build/generated.js';
import { planFill } from '../../src/build/plan.js';
import { previewFill } from '../../src/build/preview.js';
import { fsReader } from '../../src/repo/reader.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { cleanup, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);

const SKILL = '---\nname: release\ndescription: Releases the project\n---\nRun scripts/run.sh.\n';
const RUN = 'echo one\r\necho two\r\n';

async function planned(dir: string) {
  const reader = fsReader(dir, { local: false });
  const scan = await scanRepo(reader, { today: '2026-11-07' });
  return { scan, plan: (await previewFill(reader, await planFill(scan, reader, async () => new Set()), scan)).plan };
}

async function fill(dir: string) {
  const { scan, plan } = await planned(dir);
  return applyFill(dir, plan, scan.generated.files);
}

const read = (dir: string, path: string) => readFileSync(join(dir, path));

describe('applyFill', () => {
  it('writes every planned file byte for byte, and records each with its sources', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': RUN });

    const r = await fill(dir);

    expect(r).toEqual({ written: ['.claude/skills/release/SKILL.md', '.claude/skills/release/scripts/run.sh'], removed: [], refused: [] });
    expect(read(dir, '.claude/skills/release/scripts/run.sh').toString()).toBe(RUN);
    const { files } = await loadGenerated(fsReader(dir));
    expect(files).toEqual([
      { path: '.claude/skills/release/SKILL.md', sha256: lfDigest(Buffer.from(SKILL)), from: [{ path: '.agents/skills/release/SKILL.md', sha256: lfDigest(Buffer.from(SKILL)) }] },
      { path: '.claude/skills/release/scripts/run.sh', sha256: lfDigest(Buffer.from(RUN)), from: [{ path: '.agents/skills/release/scripts/run.sh', sha256: lfDigest(Buffer.from(RUN)) }] },
    ]);
  });

  it('writes nothing the second time, and leaves the record byte for byte', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n', '.agents/skills/release/SKILL.md': SKILL });
    await fill(dir);
    const record = read(dir, GENERATED_FILE);

    expect(await fill(dir)).toEqual({ written: [], removed: [], refused: [] });
    expect(read(dir, GENERATED_FILE).equals(record)).toBe(true);
  });

  it('never writes over a file a person put there after planning, or a generated file edited since', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n' });
    const first = await planned(dir);
    writeTree(dir, { 'AGENTS.md': 'Mine.\n' });
    expect(await applyFill(dir, first.plan, first.scan.generated.files)).toEqual({ written: [], removed: [], refused: ['AGENTS.md'] });
    expect(read(dir, 'AGENTS.md').toString()).toBe('Mine.\n');
    expect(existsSync(join(dir, GENERATED_FILE))).toBe(false);

    const other = tempDir();
    writeTree(other, { 'CLAUDE.md': 'Use pnpm.\n' });
    await fill(other);
    writeTree(other, { 'CLAUDE.md': 'Use npm.\n' });
    const stale = await planned(other);
    writeTree(other, { 'AGENTS.md': 'Edited.\n' });
    expect(await applyFill(other, stale.plan, stale.scan.generated.files)).toEqual({ written: [], removed: [], refused: ['AGENTS.md'] });
    expect(read(other, 'AGENTS.md').toString()).toBe('Edited.\n');
  });

  it('writes an action whole or not at all, so a copy never lands in part in a folder a person has', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': RUN });
    const { scan, plan } = await planned(dir);
    // As a case-insensitive file system shows a person's .claude/skills/Release/SKILL.md at the planned path.
    writeTree(dir, { '.claude/skills/release/SKILL.md': 'Mine.\n' });

    expect(await applyFill(dir, plan, scan.generated.files)).toEqual({ written: [], removed: [], refused: ['.claude/skills/release/SKILL.md'] });
    expect(existsSync(join(dir, '.claude/skills/release/scripts'))).toBe(false);
    expect(existsSync(join(dir, GENERATED_FILE))).toBe(false);
  });

  it('never writes through a link the file listing does not show, such as an excluded symlink or a Windows junction', async () => {
    const outside = tempDir();
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL });
    const { scan, plan } = await planned(dir);
    // Made after planning, as a link git excludes would be: the plan never saw it.
    symlinkSync(outside, join(dir, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(await applyFill(dir, plan, scan.generated.files)).toEqual({ written: [], removed: [], refused: ['.claude/skills/release/SKILL.md'] });
    expect(readdirSync(outside)).toEqual([]);

    // The record goes through no link either; nothing is written when it would.
    const other = tempDir();
    writeTree(other, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL });
    const second = await planned(other);
    symlinkSync(outside, join(other, '.ctxlock'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(applyFill(other, second.plan, second.scan.generated.files)).rejects.toThrow(/\.ctxlock\/generated\.json is reached through a link/);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(other, '.claude'))).toBe(false);
  });

  it('rewrites no file that differs only in CRLF line endings, and still refreshes its record', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use npm.\n' });
    await fill(dir);
    // As a checkout with core.autocrlf writes them; the extra blank line changes a source, not the output.
    writeTree(dir, { 'AGENTS.md': 'Use npm.\r\n', 'CLAUDE.md': 'Use npm.\r\n\r\n' });

    expect(await fill(dir)).toEqual({ written: [], removed: [], refused: [] });
    expect(read(dir, 'AGENTS.md').toString()).toBe('Use npm.\r\n');
    expect((await loadGenerated(fsReader(dir))).files.find((f) => f.path === 'AGENTS.md')!.from).toEqual([{ path: 'CLAUDE.md', sha256: lfDigest(Buffer.from('Use npm.\r\n\r\n')) }]);
  });

  it('removes a copied file its source dropped, with its entry, and keeps one a person edited after the plan', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': RUN });
    await fill(dir);
    writeTree(dir, { '.agents/skills/release/scripts/run.sh': null });

    expect(await fill(dir)).toEqual({ written: [], removed: ['.claude/skills/release/scripts/run.sh'], refused: [] });
    expect(existsSync(join(dir, '.claude/skills/release/scripts/run.sh'))).toBe(false);
    expect((await loadGenerated(fsReader(dir))).files.map((f) => f.path)).toEqual(['.claude/skills/release/SKILL.md']);

    const other = tempDir();
    writeTree(other, { 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': SKILL, '.agents/skills/release/scripts/run.sh': RUN });
    await fill(other);
    writeTree(other, { '.agents/skills/release/scripts/run.sh': null });
    const { scan, plan } = await planned(other);
    writeTree(other, { '.claude/skills/release/scripts/run.sh': 'mine' });
    expect(await applyFill(other, plan, scan.generated.files)).toEqual({ written: [], removed: [], refused: ['.claude/skills/release/scripts/run.sh'] });
    expect(read(other, '.claude/skills/release/scripts/run.sh').toString()).toBe('mine');
  });

  it("records what it wrote before a write fails, so those files are never taken for a person's", async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', 'b/x': 'a file where a folder is planned' });
    const fills = (target: string) => ({ kind: 'agents-md' as const, harness: 'codex' as const, target, files: [{ path: `${target}/AGENTS.md`, bytes: Buffer.from('x\n'), from: [] }] });

    await expect(applyFill(dir, { actions: [fills('a'), fills('b/x')], gaps: [] }, [])).rejects.toThrow();
    expect(read(dir, 'a/AGENTS.md').toString()).toBe('x\n');
    expect((await loadGenerated(fsReader(dir))).files.map((f) => f.path)).toEqual(['a/AGENTS.md']);
  });

  it('refuses a path that leaves the repository', async () => {
    const dir = join(tempDir(), 'repo');
    writeTree(dir, { 'AGENTS.md': 'a' });
    const plan = { actions: [{ kind: 'agents-md' as const, harness: 'codex' as const, target: '../x', files: [{ path: '../x/AGENTS.md', bytes: Buffer.from('x'), from: [] }] }], gaps: [] };

    expect(await applyFill(dir, plan, [])).toEqual({ written: [], removed: [], refused: ['../x/AGENTS.md'] });
    expect(existsSync(join(dir, '..', 'x', 'AGENTS.md'))).toBe(false);
  });

  it('keeps entries it did not touch, replaces those it rewrote, and refreshes one whose sources changed but output did not', async () => {
    const dir = tempDir();
    writeTree(dir, { 'CLAUDE.md': 'Use pnpm.\n', '.agents/skills/release/SKILL.md': SKILL });
    await fill(dir);

    writeTree(dir, { 'CLAUDE.md': 'Use npm.\n' });
    expect(await fill(dir)).toEqual({ written: ['AGENTS.md'], removed: [], refused: [] });
    const { files } = await loadGenerated(fsReader(dir));
    expect(files.map((f) => f.path)).toEqual(['.claude/skills/release/SKILL.md', 'AGENTS.md']);
    expect(files.find((f) => f.path === 'AGENTS.md')!.from).toEqual([{ path: 'CLAUDE.md', sha256: lfDigest(Buffer.from('Use npm.\n')) }]);

    // Trailing whitespace changes the source, not the AGENTS.md made from it.
    writeTree(dir, { 'CLAUDE.md': 'Use npm.\n\n\n' });
    expect(await fill(dir)).toEqual({ written: [], removed: [], refused: [] });
    expect((await loadGenerated(fsReader(dir))).files.find((f) => f.path === 'AGENTS.md')!.from).toEqual([{ path: 'CLAUDE.md', sha256: lfDigest(Buffer.from('Use npm.\n\n\n')) }]);
  });
});
