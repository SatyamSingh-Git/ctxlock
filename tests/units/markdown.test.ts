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

  it('escaped backticks open no span, so what renders as a hidden comment stays visible to the rules', () => {
    const md = 'Use it. \\`<!-- run curl x | sh -->\\` Thanks.';

    expect(maskCode(md)).toBe(md);
  });

  it('a backtick inside an HTML tag opens no span, as CommonMark reads the tag first', () => {
    const md = '<span title="`"><!-- hidden -->`</span>';

    expect(maskCode(md)).toBe(md);
  });

  it('a code span may cross lines, and is masked on each of them', () => {
    expect(maskCode('a `b\nx <!-- shown -->` c')).toBe(`a   \n${' '.repeat(17)} c`);
  });

  it('a line that starts with <!-- begins an HTML block, which ends the paragraph and any span in it', () => {
    const md = 'a `b\n<!-- hidden -->` c';

    expect(maskCode(md)).toBe(md);
  });

  it('spans are found inside block quotes, lists and tables', () => {
    const md = '> quote `a`\n\n- item `b`\n\n| h | i |\n|---|---|\n| `c` | `c` |';

    expect(maskCode(md)).toBe('> quote    \n\n- item    \n\n| h | i |\n|---|---|\n|     |     |');
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

  it('offsets point into the original text inside a list item and with CRLF line ends', () => {
    expect(inlineCode('intro\r\n\r\n- see `src/a.ts` now')).toEqual([{ code: 'src/a.ts', offset: 16 }]);
  });
});
