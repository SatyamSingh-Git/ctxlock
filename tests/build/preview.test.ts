import { describe, expect, it } from 'vitest';
import { planFill } from '../../src/build/plan.js';
import { previewFill } from '../../src/build/preview.js';
import { overlayReader } from '../../src/repo/overlay.js';
import { scanRepo } from '../../src/scan.js';
import { memReader } from '../helpers/mem-reader.js';

describe('overlayReader', () => {
  it('lists and reads the added files over the base, and keeps the base symlinks', async () => {
    const base = memReader({ 'a.md': 'a', 'z.md': 'z' }, { 'link.md': 'a.md' });
    const r = overlayReader(base, new Map([['a.md', Buffer.from('A')], ['m/b.md', Buffer.from('b')]]));

    expect(await r.listFiles()).toEqual(['a.md', 'm/b.md', 'z.md']);
    expect((await r.readFile('a.md')).toString()).toBe('A');
    expect((await r.readFile('z.md')).toString()).toBe('z');
    expect([await r.exists('m/b.md'), await r.exists('m'), await r.exists('nope')]).toEqual([true, true, false]);
    const all: string[] = [];
    await r.readAll((path, bytes) => void all.push(`${path}=${bytes.toString()}`));
    expect(all).toEqual(['a.md=A', 'm/b.md=b', 'z.md=z']);
    expect(await r.listSymlinks()).toEqual(new Map([['link.md', 'a.md']]));
  });
});

describe('previewFill', () => {
  const preview = async (files: Record<string, string>) => {
    const reader = memReader(files);
    const scan = await scanRepo(reader, { today: '2026-11-07' });
    return previewFill(reader, await planFill(scan, reader, async () => new Set()), scan);
  };

  it('drops an AGENTS.md that Codex would cut, and says why', async () => {
    const { plan, after } = await preview({ 'CLAUDE.md': `${'x'.repeat(40_000)}\n` });

    expect(plan.actions).toEqual([]);
    expect(plan.gaps).toEqual([
      { path: 'CLAUDE.md', harness: 'codex', fill: null, reason: 'would be cut: Codex loads only 32768 of 40001 bytes from AGENTS.md under the 32768-byte project instruction budget' },
    ]);
    // The budget after the fill is the repository without the dropped file.
    expect(after.budget.find((r) => r.harness === 'codex' && r.site === '')?.alwaysBytes).toBe(0);
  });

  it('drops an AGENTS.md whose imports add up past what Codex loads, though each file is small', async () => {
    const part = (c: string) => `${c.repeat(12_000)}\n`;
    const { plan } = await preview({ 'CLAUDE.md': '@a.md\n@b.md\n@c.md\n', 'a.md': part('a'), 'b.md': part('b'), 'c.md': part('c') });

    expect(plan.actions).toEqual([]);
    expect(plan.gaps).toEqual([
      { path: 'CLAUDE.md', harness: 'codex', fill: null, reason: 'would be cut: Codex loads only 32768 of 36024 bytes from AGENTS.md under the 32768-byte project instruction budget' },
    ]);
  });

  it('drops a fill that would cut a file a person wrote, later in the same chain, and says which', async () => {
    const { plan } = await preview({ 'CLAUDE.md': `${'x'.repeat(30_000)}\n`, 'pkg/AGENTS.md': `${'y'.repeat(5_000)}\n` });

    expect(plan.actions.map((a) => a.target)).toEqual(['pkg/CLAUDE.md']);
    expect(plan.gaps).toContainEqual({
      path: 'CLAUDE.md',
      harness: 'codex',
      fill: null,
      reason: 'would cut pkg/AGENTS.md: Codex loads only 2767 of 5001 bytes from pkg/AGENTS.md under the 32768-byte project instruction budget',
    });

    // A planned file after the cut one, cut only because the root took the room, fits once the root is
    // dropped, and stays.
    const deeper = await preview({ 'CLAUDE.md': `${'x'.repeat(30_000)}\n`, 'pkg/AGENTS.md': `${'y'.repeat(5_000)}\n`, '.claude/rules/sub.md': '---\npaths: ["pkg/sub/**"]\n---\nSub.\n' });
    expect(deeper.plan.actions.map((a) => a.target)).toEqual(['pkg/CLAUDE.md', 'pkg/sub/AGENTS.md']);
    expect(deeper.plan.gaps.find((g) => g.path === 'CLAUDE.md')?.reason).toMatch(/^would cut pkg\/AGENTS\.md: /);
    expect(deeper.after.contexts.find((c) => c.harness === 'codex' && c.site === 'pkg/sub')?.notes).toEqual([]);

    // The same when the planned file ahead was cut itself.
    const both = await preview({ 'CLAUDE.md': `${'x'.repeat(40_000)}\n`, '.claude/rules/pkg.md': '---\npaths: ["pkg/**"]\n---\nPkg.\n' });
    expect(both.plan.actions.map((a) => a.target)).toEqual(['pkg/AGENTS.md']);
  });

  it('keeps a fill when the file it comes before was cut already', async () => {
    const { plan } = await preview({ 'CLAUDE.md': 'Use pnpm.\n', 'pkg/AGENTS.md': `${'y'.repeat(40_000)}\n`, 'pkg/CLAUDE.md': '@AGENTS.md\n' });
    expect(plan.actions.map((a) => a.target)).toEqual(['AGENTS.md']);
  });

  it('keeps a skill copy: a listed skill loads its catalog entry only, which is no cut', async () => {
    const { plan } = await preview({ 'AGENTS.md': 'a', '.agents/skills/release/SKILL.md': '---\nname: release\ndescription: Releases\n---\nBody.\n' });
    expect(plan.actions.map((a) => a.target)).toEqual(['.claude/skills/release']);
  });

  it('keeps one that fits, and shows the budget after it is written', async () => {
    const { plan, after } = await preview({ 'CLAUDE.md': `${'x'.repeat(1_000)}\n` });

    expect(plan.actions.map((a) => a.target)).toEqual(['AGENTS.md']);
    expect(after.budget.find((r) => r.harness === 'codex' && r.site === '')?.alwaysBytes).toBe(1_001);
  });
});
