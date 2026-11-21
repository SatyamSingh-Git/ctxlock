import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { format } from '../../src/lint/rules/l17-format.js';
import { staleReferences } from '../../src/lint/rules/l9-stale.js';
import type { Rule } from '../../src/lint/types.js';
import { lintContext } from '../helpers/lint.js';

const fixture = (path: string) => readFileSync(`tests/fixtures/${path}`, 'utf8');
const run = async (files: Record<string, string>, rule: Rule = format) => (await rule.check(await lintContext(files))).map((f) => [f.rule, f.severity, f.path, f.message]);
const model = (body: string) => `version: 0.3.0.dev0\nname: m\n${body}`;
const concept = (frontmatter: string) => `---\n${frontmatter}\n---\n# Body\n`;
const KB = { 'ctxlock.yaml': 'version: 1\nknowledge: [kb]\n' };

describe('L17-format', () => {
  it('the Ossie spec example and its retail model pass', async () => {
    expect(await run({ 'a.ossie.yaml': fixture('ossie/sales_analytics.ossie.yaml'), 'b.ossie.yaml': fixture('ossie/retail_model.ossie.yaml') })).toEqual([]);
  });

  it('an Ossie file for 0.2.0.dev0 gets one finding that names both versions', async () => {
    const old = 'version: 0.2.0.dev0\nsemantic_model:\n  - name: m\n    datasets: []\n';
    expect(await run({ 'm.ossie.yaml': old })).toEqual([
      ['L17-format', 'must', 'm.ossie.yaml', 'Ossie 0.3.0.dev0 is the version this checks; the file says 0.2.0.dev0'],
    ]);
    expect((await run({ 'm.ossie.yaml': 'name: m\ndatasets: []\n' }))[0]![3]).toBe('Ossie 0.3.0.dev0 is the version this checks; the file says none');
  });

  it('schema errors are listed by where they are, five at most', async () => {
    const seven = model(`datasets:\n${Array.from({ length: 7 }, (_, i) => `  - name: d${i}\n`).join('')}`);
    const found = await run({ 'm.ossie.yaml': seven });
    expect(found).toHaveLength(6);
    expect(found[0]).toEqual(['L17-format', 'must', 'm.ossie.yaml', "/datasets/0: must have required property 'source'"]);
    expect(found[5]).toEqual(['L17-format', 'must', 'm.ossie.yaml', 'and 2 more']);
    expect(await run({ 'm.ossie.yaml': model('datasets:\n  - { name: d, source: s.t }\ncustom_extensions: []\n') })).toEqual([
      ['L17-format', 'must', 'm.ossie.yaml', '(root): must NOT have additional properties (custom_extensions)'],
    ]);
  });

  it('a model that does not parse is a must', async () => {
    expect(await run({ 'm.ossie.yaml': 'name: [unclosed\n' })).toEqual([['L17-format', 'must', 'm.ossie.yaml', expect.stringMatching(/^m\.ossie\.yaml does not parse: /)]]);
  });

  it('a concept needs a type, a known status and timestamps with an offset', async () => {
    expect(await run({ ...KB, 'kb/a.md': concept("type: ''") })).toEqual([['L17-format', 'must', 'kb/a.md', 'kb/a.md has no type: OKF needs a non-empty type string']]);
    expect(await run({ ...KB, 'kb/a.md': concept('title: A') })).toEqual([['L17-format', 'must', 'kb/a.md', 'kb/a.md has no type: OKF needs a non-empty type string']]);
    // No frontmatter at all is no type either; frontmatter that does not parse is L0-frontmatter's alone.
    expect(await run({ ...KB, 'kb/README.md': '# Notes\n' })).toEqual([['L17-format', 'must', 'kb/README.md', 'kb/README.md has no type: OKF needs a non-empty type string']]);
    expect(await run({ ...KB, 'kb/a.md': '---\ntype: [\n---\n' })).toEqual([]);
    expect(await run({ ...KB, 'kb/a.md': concept('type: Reference\nstatus: final') })).toEqual([
      ['L17-format', 'should', 'kb/a.md', 'kb/a.md has status final; OKF knows draft, stable and deprecated'],
    ]);
    const dates = concept('type: Reference\nstale_after: 2026-12-31\ngenerated: { by: x, at: 2026-06-20T22:53:05 }\nverified: [{ by: human:a, at: 2026-06-25T09:00:00Z }, { by: human:b, at: soon }]');
    expect(await run({ ...KB, 'kb/a.md': dates })).toEqual([
      ['L17-format', 'should', 'kb/a.md', 'kb/a.md: stale_after is 2026-12-31, not an ISO 8601 time with an offset'],
      ['L17-format', 'should', 'kb/a.md', 'kb/a.md: generated.at is 2026-06-20T22:53:05, not an ISO 8601 time with an offset'],
      ['L17-format', 'should', 'kb/a.md', 'kb/a.md: verified[1].at is soon, not an ISO 8601 time with an offset'],
    ]);
    // A bare verified mapping is a list of one, and a time that has the shape but no such day is no time.
    expect(await run({ ...KB, 'kb/a.md': concept('type: Reference\nverified: { by: human:a, at: 2026-13-45T00:00:00Z }') })).toEqual([
      ['L17-format', 'should', 'kb/a.md', 'kb/a.md: verified.at is 2026-13-45T00:00:00Z, not an ISO 8601 time with an offset'],
    ]);
  });

  it("OKF's Appendix A bundle passes", async () => {
    const files = { 'index.md': fixture('okf/index.md'), ...Object.fromEntries(['metrics/income-statement.md', 'computations/revenue.md', 'computations/profit.md'].map((p) => [p, fixture(`okf/${p}`)])) };
    expect(await run(files)).toEqual([]);
  });

  it('a metric unit is not read as Markdown by L9', async () => {
    const text = model('description: Reads `src/missing.ts` for its numbers.\ndatasets: []\n');
    // L9 checks a path only where its first folder exists.
    const src = { 'src/other.ts': '' };
    expect(await run({ ...src, 'm.ossie.yaml': text }, staleReferences)).toEqual([]);
    expect(await run({ ...KB, ...src, 'kb/a.md': concept('type: Reference').replace('# Body', 'Reads `src/missing.ts`.') }, staleReferences)).toEqual([
      ['L9-stale', 'should', 'kb/a.md', 'src/missing.ts at 4:8 does not exist'],
    ]);
  });
});
