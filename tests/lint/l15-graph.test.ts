import { describe, expect, it } from 'vitest';
import { graphRefs } from '../../src/lint/rules/l15-graph.js';
import { lintContext } from '../helpers/lint.js';

const run = async (files: Record<string, string>) => (await graphRefs.check(await lintContext(files))).map((f) => [f.severity, f.path, f.message]);

const RULES = { '.claude/rules/a.md': 'Use pnpm.\n', '.claude/rules/b.md': 'Run pnpm test.\n' };
const PROBE = 'probes:\n  - id: uses-pnpm\n    unit: rule/.claude/rules/a.md\n    prompt: Add zod.\n    expect:\n      command: pnpm add\n';

describe('L15-graph', () => {
  it('reports each reference to no unit, each unmet tier, and evals that hold no probe file', async () => {
    const yaml = `version: 1
units:
  gone.md: {}
  .claude/rules/b.md:
    depends-on: [missing.md, .claude/rules/a.md@certified]
consumers:
  payments-api:
    depends-on: [nope.md, .claude/rules/b.md@certified]
    evals: [evals/probes/payments.yaml]
  web:
    evals: [README.md, evals/probes/we]
`;
    expect(await run({ ...RULES, 'ctxlock.yaml': yaml, 'README.md': '# Web\n', 'evals/probes/web.yaml': PROBE })).toEqual([
      ['should', 'ctxlock.yaml', 'ctxlock.yaml lists gone.md, which is no unit'],
      ['should', 'ctxlock.yaml', '.claude/rules/b.md depends on missing.md, which is no unit'],
      ['should', 'ctxlock.yaml', 'consumer payments-api depends on nope.md, which is no unit'],
      ['should', 'ctxlock.yaml', '.claude/rules/b.md needs .claude/rules/a.md at certified; it is reviewed'],
      ['should', 'ctxlock.yaml', 'consumer payments-api needs .claude/rules/b.md at certified; it is reviewed'],
      ['should', 'ctxlock.yaml', 'consumer payments-api lists evals evals/probes/payments.yaml, which holds no probe file'],
      ['should', 'ctxlock.yaml', 'consumer web lists evals README.md, which holds no probe file'],
      ['should', 'ctxlock.yaml', 'consumer web lists evals evals/probes/we, which holds no probe file'],
    ]);
  });

  it('reports nothing when every reference names a unit, every tier is met, and every evals path holds a probe file', async () => {
    const yaml = `version: 1
units:
  .claude/rules/a.md:
    tier: certified
  .claude/rules/b.md:
    depends-on: [.claude/rules/a.md@imported]
consumers:
  payments-api:
    depends-on: [.claude/rules/b.md@reviewed, rule/.claude/rules/a.md]
    evals: [evals/probes/payments.yaml, evals/probes, ./evals/probes/]
`;
    expect(await run({ ...RULES, 'ctxlock.yaml': yaml, 'evals/probes/payments.yaml': PROBE })).toEqual([]);
  });

  it('reports a reference left behind when the unit it names is removed', async () => {
    const { '.claude/rules/a.md': _, ...rest } = RULES;
    const yaml = 'version: 1\nunits:\n  .claude/rules/b.md:\n    depends-on: [.claude/rules/a.md]\n';
    expect(await run({ ...RULES, 'ctxlock.yaml': yaml })).toEqual([]);
    expect(await run({ ...rest, 'ctxlock.yaml': yaml })).toEqual([['should', 'ctxlock.yaml', '.claude/rules/b.md depends on .claude/rules/a.md, which is no unit']]);
  });
});
