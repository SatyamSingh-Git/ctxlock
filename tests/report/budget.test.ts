import { describe, expect, it } from 'vitest';
import { LIMITS, type Limits } from '../../src/harness/limits.js';
import { resolveAll } from '../../src/harness/resolve.js';
import { budgetReport } from '../../src/report/budget.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

async function budget(files: Record<string, string>, limits: Limits = { ...LIMITS }) {
  const reader = memReader(files);
  const { units } = await discoverUnits(reader);
  return budgetReport(await resolveAll({ reader, units, limits }, ['claude-code', 'codex']), limits);
}

const bigRepo = {
  'AGENTS.md': 'a'.repeat(40_000),
  'CLAUDE.md': 'short',
  '.agents/skills/s/SKILL.md': '---\nname: s\ndescription: Does s\n---\nbody\n',
  // Claude Code lists a nested skill only once the agent works in pkg/, so it stays out of the catalog count.
  'pkg/.claude/skills/n/SKILL.md': '---\nname: n\ndescription: Nested\n---\nbody\n',
};

describe('budgetReport', () => {
  it('lists truncated paths per harness and site', async () => {
    expect(await budget(bigRepo)).toEqual([
      { harness: 'claude-code', site: '', alwaysBytes: 5, limitBytes: null, catalogChars: 0, catalogLimit: null, truncated: [] },
      {
        harness: 'codex',
        site: '',
        alwaysBytes: 32_768,
        limitBytes: 32_768,
        catalogChars: 's'.length + 'Does s'.length + '.agents/skills/s'.length,
        catalogLimit: 8000,
        truncated: ['AGENTS.md'],
      },
    ]);
  });

  it('a codexChainBytes override of 65536 removes the truncation', async () => {
    const codexRow = (await budget(bigRepo, { ...LIMITS, codexChainBytes: 65_536 })).find((r) => r.harness === 'codex');

    expect(codexRow).toMatchObject({ alwaysBytes: 40_000, limitBytes: 65_536, truncated: [] });
  });
});
