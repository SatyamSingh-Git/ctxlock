import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/harness/limits.js';
import { resolveAll } from '../../src/harness/resolve.js';
import type { Unit } from '../../src/model.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

describe('resolveAll', () => {
  it('gives the agent models only modelled units, so another family adds no site and no entry', async () => {
    const reader = memReader({ 'AGENTS.md': 'a', 'CLAUDE.md': 'c', 'sub/AGENTS.md': 'sub' });
    const { units } = await discoverUnits(reader);
    const resolve = (us: Unit[]) => resolveAll({ reader, units: us, limits: { ...LIMITS } }, ['claude-code', 'codex']);

    const retagged = units.map((u): Unit => (u.path === 'sub/AGENTS.md' ? { ...u, family: 'cursor' } : u));
    const contexts = await resolve(retagged);

    expect(contexts).toEqual(await resolve(units.filter((u) => u.path !== 'sub/AGENTS.md')));
    expect(contexts.map((c) => c.site)).not.toContain('sub');
  });
});
