import { describe, expect, it, vi } from 'vitest';
import { findDirectives } from '../../src/lint/suppress.js';
import { maskCode } from '../../src/units/markdown.js';
import { lintContext } from '../helpers/lint.js';

vi.mock('../../src/units/markdown.js', async (original) => {
  const actual = await original<typeof import('../../src/units/markdown.js')>();
  return { ...actual, maskCode: vi.fn(actual.maskCode) };
});

describe('findDirectives', () => {
  it('parses only the markdown files that mention ctxlock-ignore', async () => {
    const ctx = await lintContext({
      'AGENTS.md': 'Use pnpm.\n',
      'CLAUDE.md': '@AGENTS.md\n',
      '.claude/rules/style.md': '<!-- ctxlock-ignore-file L9-stale: old -->\n',
    });
    vi.mocked(maskCode).mockClear();

    const directives = await findDirectives(ctx);

    expect(directives.map((d) => d.path)).toEqual(['.claude/rules/style.md']);
    expect(maskCode).toHaveBeenCalledTimes(1);
  });
});
