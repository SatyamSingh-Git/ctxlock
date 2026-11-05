// Cases ported from Codex's own AGENTS.md loader tests:
//   openai/codex codex-rs/core/src/agents_md_tests.rs
//   at commit 49f0c6022596c361fe676a5c4738fb2be34e3a93
//   Copyright OpenAI, licensed under the Apache License, Version 2.0.
// Each test keeps the upstream name and reproduces its fixture and expectation, so
// ctxlock's Codex prediction is checked against Codex's behaviour without running Codex.
import { describe, expect, it } from 'vitest';
import { resolveCodex } from '../../src/harness/codex.js';
import { LIMITS } from '../../src/harness/limits.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

async function codex(files: Record<string, string | Buffer>, limit: number, site = '') {
  const reader = memReader(files);
  const { units } = await discoverUnits(reader);
  return resolveCodex({ reader, units, limits: { ...LIMITS, codexChainBytes: limit } }, site);
}

const chain = (ctx: Awaited<ReturnType<typeof codex>>) =>
  ctx.entries.filter((e) => e.mode === 'always').map((e) => [e.path, e.loadedBytes]);

describe('Codex AGENTS.md conformance', () => {
  it('no_doc_file_returns_none', async () => {
    expect(chain(await codex({}, 4096))).toEqual([]);
  });

  it('doc_smaller_than_limit_is_returned', async () => {
    expect(chain(await codex({ 'AGENTS.md': 'hello world' }, 4096))).toEqual([['AGENTS.md', 11]]);
  });

  it('doc_larger_than_limit_is_truncated', async () => {
    const ctx = await codex({ 'AGENTS.md': 'A'.repeat(2048) }, 1024);

    expect(chain(ctx)).toEqual([['AGENTS.md', 1024]]);
    expect(ctx.notes.join('\n')).toMatch(/1024 of 2048 bytes from AGENTS\.md/);
  });

  it('total_byte_limit_truncates_later_project_docs', async () => {
    const ctx = await codex({ 'AGENTS.md': 'root', 'nested/AGENTS.md': 'abcdef' }, 7, 'nested');

    expect(chain(ctx)).toEqual([
      ['AGENTS.md', 4],
      ['nested/AGENTS.md', 3],
    ]);
  });

  it('zero_byte_limit_disables_docs', async () => {
    const ctx = await codex({ 'AGENTS.md': 'something' }, 0);

    expect(ctx.alwaysBytes).toBe(0);
    expect(ctx.entries.every((e) => e.loadedBytes === 0)).toBe(true);
  });

  it('finds_doc_in_repo_root', async () => {
    expect(chain(await codex({ 'AGENTS.md': 'root level doc' }, 4096, 'workspace/crate_a'))).toEqual([
      ['AGENTS.md', 14],
    ]);
  });

  it('project_doc_invalid_utf8_uses_lossy_text', async () => {
    const ctx = await codex({ 'AGENTS.md': Buffer.from('project\xFF doc', 'latin1') }, 4096);

    expect(chain(ctx)).toEqual([['AGENTS.md', 12]]);
  });
});
