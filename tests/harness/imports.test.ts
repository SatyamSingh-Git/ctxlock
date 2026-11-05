import { describe, expect, it } from 'vitest';
import { findImports } from '../../src/harness/imports.js';

describe('findImports', () => {
  it('finds @path tokens and strips trailing punctuation', () => {
    expect(findImports('See @docs/a.md. Also @AGENTS.md, and @./b.md\n@c.md')).toEqual([
      'docs/a.md',
      'AGENTS.md',
      './b.md',
      'c.md',
    ]);
  });

  it('ignores email addresses, fenced code and inline code', () => {
    const md = ['Mail user@example.com', '```', '@fenced.md', '```', 'Use `pnpm add @inline.md` here', '~~~', '@tilde.md', '~~~'].join('\n');

    expect(findImports(md)).toEqual([]);
  });
});
