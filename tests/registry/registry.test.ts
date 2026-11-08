import { describe, expect, it } from 'vitest';
import { RegistryError, loadRegistry } from '../../src/registry/registry.js';
import { memReader } from '../helpers/mem-reader.js';

const load = (yaml?: string) => loadRegistry(memReader(yaml === undefined ? {} : { 'ctxlock.yaml': yaml }));
const errorOf = (yaml: string) => load(yaml).then(
  () => {
    throw new Error('expected a RegistryError');
  },
  (e: unknown) => e as Error,
);

describe('loadRegistry', () => {
  it('absent ctxlock.yaml gives present false and harnesses [claude-code, codex]', async () => {
    expect(await load()).toEqual({
      present: false,
      harnesses: ['claude-code', 'codex'],
      units: {},
      consumers: [],
      limits: {},
      lint: { severity: {}, ignore: [] },
      eval: { model: 'sonnet', runs: 3, maxRuns: 24, maxMinutes: 20 },
    });
  });

  it("kebab-case unit fields map to camelCase and 2026-10-01 stays the string '2026-10-01'", async () => {
    const registry = await load(`version: 1
units:
  AGENTS.md:
    owner: "@platform"
    tier: certified
    verified-at: 2026-10-01
    stale-after: 2027-01-01
    sources: [https://example.com/policy]
    depends-on: [.agents/skills/release-notes]
`);

    expect(registry.present).toBe(true);
    expect(registry.units['AGENTS.md']).toEqual({
      owner: '@platform',
      tier: 'certified',
      verifiedAt: '2026-10-01',
      staleAfter: '2027-01-01',
      sources: ['https://example.com/policy'],
      dependsOn: [{ ref: '.agents/skills/release-notes' }],
    });
  });

  it('a depends-on entry may require a tier after its last @', async () => {
    const registry = await load('version: 1\nunits:\n  b.md:\n    depends-on: [a.md@proposal, docs/@scope/c.md, "@notes", notes@v2.md]\n');
    expect(registry.units['b.md']!.dependsOn).toEqual([{ ref: 'a.md', tier: 'proposal' }, { ref: 'docs/@scope/c.md' }, { ref: '@notes' }, { ref: 'notes@v2.md' }]);
  });

  it('an unknown key throws RegistryError naming units.AGENTS.md.ownr', async () => {
    const err = await errorOf('version: 1\nunits:\n  AGENTS.md:\n    ownr: "@x"\n');

    expect(err).toBeInstanceOf(RegistryError);
    expect(err.message).toContain('units.AGENTS.md.ownr');
  });

  it('an invalid tier throws RegistryError listing certified, reviewed, imported, proposal', async () => {
    const err = await errorOf('version: 1\nunits:\n  AGENTS.md:\n    tier: gold\n');

    expect(err).toBeInstanceOf(RegistryError);
    expect(err.message).toContain('units.AGENTS.md.tier');
    for (const tier of ['certified', 'reviewed', 'imported', 'proposal']) expect(err.message).toContain(tier);
  });

  it('an unknown limits key throws RegistryError', async () => {
    const err = await errorOf('version: 1\nlimits:\n  codexChainByte: 1\n');

    expect(err).toBeInstanceOf(RegistryError);
    expect(err.message).toContain('limits.codexChainByte');
  });

  it('a limit of 0 is kept and a negative limit is rejected', async () => {
    expect((await load('version: 1\nlimits:\n  codexChainBytes: 0\n')).limits).toEqual({ codexChainBytes: 0 });
    expect(await errorOf('version: 1\nlimits:\n  codexChainBytes: -1\n')).toBeInstanceOf(RegistryError);
  });

  it('a missing version is a RegistryError', async () => {
    const err = await errorOf('units: {}\n');

    expect(err).toBeInstanceOf(RegistryError);
    expect(err.message).toContain('version');
  });

  it('eval settings map to camelCase, default when absent, and are checked', async () => {
    expect((await load('version: 1\neval:\n  model: claude-sonnet-5-5\n  runs: 5\n  max-runs: 30\n  max-minutes: 10\n')).eval).toEqual({
      model: 'claude-sonnet-5-5',
      runs: 5,
      maxRuns: 30,
      maxMinutes: 10,
    });
    expect((await load('version: 1\neval:\n  runs: 2\n')).eval).toEqual({ model: 'sonnet', runs: 2, maxRuns: 24, maxMinutes: 20 });
    expect((await errorOf('version: 1\neval:\n  x: 1\n')).message).toContain('eval.x: unknown key');
    expect(await errorOf('version: 1\neval:\n  runs: 0\n')).toBeInstanceOf(RegistryError);
    expect(await errorOf('version: 1\neval:\n  max-runs: 1\n')).toBeInstanceOf(RegistryError);
  });

  it('invalid YAML is a RegistryError, not a raw parser error', async () => {
    expect(await errorOf('version: 1\nunits: [unclosed\n')).toBeInstanceOf(RegistryError);
  });
});

describe('loadRegistry: consumers', () => {
  const PAYMENTS = `version: 1
consumers:
  payments-api:
    owner: "@payments-team"
    harnesses: [claude-code, codex]
    models: [claude-opus-5-5]
    repos: [acme/payments-api]
    depends-on:
      - .agents/skills/api-conventions@certified
      - .claude/rules/testing.md
    evals: [evals/probes/payments.yaml]
    maturity: production
`;

  it('reads a consumer, each requirement split into its path and the tier it needs', async () => {
    expect((await load(PAYMENTS)).consumers).toEqual([
      {
        name: 'payments-api',
        owner: '@payments-team',
        harnesses: ['claude-code', 'codex'],
        models: ['claude-opus-5-5'],
        repos: ['acme/payments-api'],
        dependsOn: [{ ref: '.agents/skills/api-conventions', tier: 'certified' }, { ref: '.claude/rules/testing.md' }],
        evals: ['evals/probes/payments.yaml'],
        maturity: 'production',
      },
    ]);
  });

  it('reads evals paths as people type them: from ./, with a closing slash, or with Windows separators', async () => {
    const registry = await load('version: 1\nconsumers:\n  web:\n    evals: [./evals/probes/web.yaml, "evals\\\\probes\\\\", evals/probes/a/]\n');
    expect(registry.consumers[0]!.evals).toEqual(['evals/probes/web.yaml', 'evals/probes', 'evals/probes/a']);
  });

  it("fills in the registry's harnesses and empty lists, and sorts consumers by name", async () => {
    const registry = await load('version: 1\nharnesses: [codex]\nconsumers:\n  web:\n    depends-on: [a.md]\n  api: {}\n');
    expect(registry.consumers).toEqual([
      { name: 'api', harnesses: ['codex'], models: [], repos: [], dependsOn: [], evals: [], maturity: 'production' },
      { name: 'web', harnesses: ['codex'], models: [], repos: [], dependsOn: [{ ref: 'a.md' }], evals: [], maturity: 'production' },
    ]);
  });

  it('names the key of a tier that is none, an unknown key, an unknown harness and an unknown maturity', async () => {
    const consumer = (body: string) => errorOf(`version: 1\nconsumers:\n  payments-api:\n${body}`);

    expect((await consumer('    depends-on: [x@latest]\n')).message).toContain(
      'consumers.payments-api.depends-on.0: "latest" is not a tier (certified, reviewed, imported, proposal)',
    );
    expect((await consumer('    foo: 1\n')).message).toContain('consumers.payments-api.foo: unknown key');
    expect((await consumer('    harnesses: [cursor]\n')).message).toContain('consumers.payments-api.harnesses.0');
    expect((await consumer('    maturity: retired\n')).message).toContain('consumers.payments-api.maturity');
  });
});
