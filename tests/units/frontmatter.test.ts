import { describe, expect, it } from 'vitest';
import { sha256Hex, unitDigest } from '../../src/units/digest.js';
import { splitFrontmatter } from '../../src/units/frontmatter.js';

describe('splitFrontmatter', () => {
  it('gives the same result for LF, CRLF and BOM-prefixed input', () => {
    const lf = '---\nname: x\nverified-at: 2026-10-01\n---\nbody line\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const bom = String.fromCharCode(0xfeff) + lf;
    const expected = { frontmatter: { name: 'x', 'verified-at': '2026-10-01' }, body: 'body line\n', error: null };

    expect(splitFrontmatter(lf)).toEqual(expected);
    expect(splitFrontmatter(crlf)).toEqual(expected);
    expect(splitFrontmatter(bom)).toEqual(expected);
  });

  it('returns the whole text as body when there is no frontmatter', () => {
    expect(splitFrontmatter('# Title\n---\nnot frontmatter\n')).toEqual({
      frontmatter: null,
      body: '# Title\n---\nnot frontmatter\n',
      error: null,
    });
  });

  it('reports invalid YAML without throwing', () => {
    const result = splitFrontmatter('---\nname: [unclosed\n---\nbody\n');
    expect(result.frontmatter).toBeNull();
    expect(result.error).toMatch(/\S/);
  });
});

describe('unitDigest', () => {
  const a = { path: 'a.md', bytes: 1, sha256: sha256Hex('a') };
  const b = { path: 'b/c.sh', bytes: 1, sha256: sha256Hex('b') };

  it('is independent of input order', () => {
    expect(unitDigest([a, b])).toBe(unitDigest([b, a]));
    expect(unitDigest([a, b])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when any file changes', () => {
    expect(unitDigest([a, { ...b, sha256: sha256Hex('changed') }])).not.toBe(unitDigest([a, b]));
  });
});
