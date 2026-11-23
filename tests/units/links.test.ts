import { describe, expect, it } from 'vitest';
import { discoverUnits } from '../../src/units/discover.js';
import { linkedPaths } from '../../src/units/links.js';
import { memReader } from '../helpers/mem-reader.js';

const unitAt = async (path: string, body: string) => {
  const { units } = await discoverUnits(memReader({ [path]: `---\ntype: Metric\n---\n${body}` }), { knowledge: ['kb'], metrics: [] });
  return units[0]!;
};

describe('linkedPaths', () => {
  it('a concept links to units by relative path, fragment dropped; URLs and anchors are not links to units', async () => {
    const unit = await unitAt('kb/c/x.md', '[a](../m/nrr.ossie.yaml) [b](./seg.md#x) [c](https://x.y/a.md) [d](#top) [e](../../../out.md) [f](seg.md?v=2) [g](mailto:a@b.c) [h](/kb/c/root.md)\n');
    expect(linkedPaths(unit)).toEqual(['kb/m/nrr.ossie.yaml', 'kb/c/seg.md', 'kb/c/root.md']);
  });

  it('a link starting with / is from the repository root, as GitHub reads it; //host is a URL', async () => {
    const unit = await unitAt('kb/c/x.md', '[a](/models/revenue.ossie.yaml) [b](//cdn.example.com/a.md) [c](/../out.md) [d](/)\n');
    expect(linkedPaths(unit)).toEqual(['models/revenue.ossie.yaml']);
  });

  it('a link in code is not a link, and a reference-style link is', async () => {
    const unit = await unitAt('kb/x.md', '`[a](a.md)`\n\n```\n[b](b.md)\n```\n\nSee [the metric][m].\n\n[m]: ../models/nrr.ossie.yaml\n');
    expect(linkedPaths(unit)).toEqual(['models/nrr.ossie.yaml']);
  });

  it('an angle-bracketed path with a space, and one written with %20, are the same path', async () => {
    const unit = await unitAt('kb/x.md', '[a](<net revenue.md>) [b](net%20revenue.md)\n');
    expect(linkedPaths(unit)).toEqual(['kb/net revenue.md']);
  });
});
