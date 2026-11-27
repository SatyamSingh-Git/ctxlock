import { describe, expect, it } from 'vitest';
import { renderScan } from '../../src/report/render.js';
import { scanRepo } from '../../src/scan.js';
import { memReader } from '../helpers/mem-reader.js';

const esc = String.fromCodePoint(0x1b);

describe('renderScan', () => {
  it("never prints a control character from the repository's files in lint's text output", async () => {
    const scan = await scanRepo(memReader({ 'AGENTS.md': `<!-- ctxlock-ignore-file L9-stale: clears ${esc}[2J the screen -->\nUse pnpm.\n` }));

    const text = renderScan(scan, 'lint', 'text');

    expect(text).toContain('L18-unused');
    expect(text).not.toContain(esc);
    expect(text).toContain('clears ?[2J the screen');
  });
});
