import { describe, expect, it } from 'vitest';
import { inlineCode, maskCode } from '../../src/units/markdown.js';

describe('maskCode', () => {
  it('blanks fenced blocks and inline code to spaces of the same length, keeping lines', () => {
    const md = 'a `b` c\n```\ncode\n```\nd';

    expect(maskCode(md)).toBe('a     c\n   \n    \n   \nd');
  });

  it('a fence closes only on the same character, at least as long, alone on its line', () => {
    const md = ['~~~', '```', 'in tilde', '~~~', '````', '```', 'in long', '````', '```', '```js', 'in short', '```', 'out'].join('\n');

    expect(maskCode(md).split('\n').map((l) => l.trim())).toEqual(['', '', '', '', '', '', '', '', '', '', '', '', 'out']);
  });

  it('masks a double-backtick span that contains a backtick', () => {
    expect(maskCode('x ``a ` b`` y')).toBe(`x ${' '.repeat(9)} y`);
  });
});

describe('inlineCode', () => {
  it('returns the spans outside fenced blocks, with the offset of each one\'s content', () => {
    const md = 'Run `npm test` or ``a `b` c``.\n```\n`fenced`\n```\nThen `x`.';

    expect(inlineCode(md)).toEqual([
      { code: 'npm test', offset: 5 },
      { code: 'a `b` c', offset: 20 },
      { code: 'x', offset: 54 },
    ]);
  });
});
