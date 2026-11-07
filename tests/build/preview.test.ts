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
    return previewFill(reader, await planFill(scan, reader), scan.registry);
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
