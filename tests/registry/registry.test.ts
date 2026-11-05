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
      limits: {},
      lint: { severity: {}, ignore: [] },
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
      dependsOn: ['.agents/skills/release-notes'],
    });
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

  it('invalid YAML is a RegistryError, not a raw parser error', async () => {
    expect(await errorOf('version: 1\nunits: [unclosed\n')).toBeInstanceOf(RegistryError);
  });
});
