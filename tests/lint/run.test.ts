import { describe, expect, it } from 'vitest';
import { runLint } from '../../src/lint/run.js';
import type { Finding, Severity } from '../../src/model.js';
import { lintContext } from '../helpers/lint.js';

const finding = (rule: string, severity: Severity, path?: string, line?: number): Finding => ({
  rule,
  severity,
  message: `${rule} finding`,
  ...(path === undefined ? {} : { path }),
  ...(line === undefined ? {} : { line }),
});

const yaml = (lint: string) => ({ 'ctxlock.yaml': `version: 1\nlint:\n${lint}` });

describe('runLint', () => {
  it('a lint.severity override downgrades a rule, and off drops it', async () => {
    const ctx = await lintContext(yaml('  severity:\n    X-a: info\n    X-b: "off"\n'));

    const out = await runLint(ctx, [finding('X-a', 'must', 'a.md'), finding('X-b', 'must', 'b.md'), finding('X-c', 'should', 'c.md')]);

    expect(out.map((f) => [f.rule, f.severity])).toEqual([
      ['X-c', 'should'],
      ['X-a', 'info'],
    ]);
  });

  it('lint.ignore drops findings under the glob', async () => {
    const ctx = await lintContext(yaml('  ignore:\n    - "vendor/**"\n'));

    const out = await runLint(ctx, [finding('X', 'must', 'vendor/x/AGENTS.md'), finding('X', 'must', 'AGENTS.md'), finding('Y', 'must')]);

    expect(out.map((f) => f.path)).toEqual([undefined, 'AGENTS.md']);
  });

  it('findings sort must, should, info, then by path, then by line', async () => {
    const ctx = await lintContext({});

    const out = await runLint(ctx, [
      finding('A', 'info', 'a.md', 1),
      finding('B', 'should', 'b.md', 9),
      finding('C', 'must', 'b.md', 2),
      finding('D', 'should', 'b.md', 3),
      finding('E', 'must', 'a.md', 5),
    ]);

    expect(out.map((f) => f.rule)).toEqual(['E', 'C', 'D', 'B', 'A']);
  });

  it('reports identical findings once', async () => {
    const out = await runLint(await lintContext({}), [finding('X', 'must', 'a.md', 1), finding('X', 'must', 'a.md', 1)]);

    expect(out).toHaveLength(1);
  });

  it('runs every rule over the repository', async () => {
    const ctx = await lintContext({
      'AGENTS.md': `<!-- note -->\nok${String.fromCodePoint(0x200b)}\n`,
      '.agents/skills/Bad/SKILL.md': '---\nname: Bad\ndescription: d\n---\n',
    });

    expect((await runLint(ctx)).map((f) => f.rule)).toEqual(['L0-skill-spec', 'L1-html-comment', 'L1-hidden-unicode']);
  });
});
