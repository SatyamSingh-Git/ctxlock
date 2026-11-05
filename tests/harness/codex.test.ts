import { describe, expect, it } from 'vitest';
import { resolveCodex } from '../../src/harness/codex.js';
import { LIMITS } from '../../src/harness/limits.js';
import { contextSites } from '../../src/harness/resolve.js';
import { discoverUnits } from '../../src/units/discover.js';
import { memReader } from '../helpers/mem-reader.js';

async function resolve(files: Record<string, string>, site = '', symlinks: Record<string, string | null> = {}) {
  const reader = memReader(files, symlinks);
  const { units } = await discoverUnits(reader);
  return resolveCodex({ reader, units, limits: { ...LIMITS } }, site);
}

const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`;

describe('resolveCodex', () => {
  it('one file per directory from root to site, and AGENTS.override.md beats AGENTS.md', async () => {
    const ctx = await resolve(
      { 'AGENTS.md': 'root', 'pkg/AGENTS.md': 'pkg', 'pkg/AGENTS.override.md': 'override', 'pkg/sub/AGENTS.md': 'below' },
      'pkg',
    );

    expect(ctx.entries.map((e) => [e.path, e.mode, e.reason])).toEqual([
      ['AGENTS.md', 'always', 'chain'],
      ['pkg/AGENTS.override.md', 'always', 'chain'],
    ]);
  });

  it('files of 20,000 + 20,000 bytes: the second gets loadedBytes 12,768 and any third gets 0 with reason chain-dropped', async () => {
    const ctx = await resolve(
      {
        'AGENTS.md': 'a'.repeat(20_000),
        'x/AGENTS.md': 'b'.repeat(20_000),
        'x/y/AGENTS.md': 'c'.repeat(10),
        'x/y/z/AGENTS.md': 'd',
      },
      'x/y/z',
    );

    expect(ctx.entries.map((e) => [e.path, e.loadedBytes, e.reason])).toEqual([
      ['AGENTS.md', 20_000, 'chain'],
      ['x/AGENTS.md', 12_768, 'chain'],
      ['x/y/AGENTS.md', 0, 'chain-dropped'],
      ['x/y/z/AGENTS.md', 0, 'chain-dropped'],
    ]);
    expect(ctx.alwaysBytes).toBe(32_768);
    expect(ctx.notes).toEqual([
      'Codex loads only 12768 of 20000 bytes from x/AGENTS.md under the 32768-byte project instruction budget',
      'Codex skips x/y/AGENTS.md and later AGENTS files: the 32768-byte project instruction budget is used up',
    ]);
  });

  it('an AGENTS.md below the site is not loaded', async () => {
    const ctx = await resolve({ 'AGENTS.md': 'root', 'pkg/AGENTS.md': 'pkg' });

    expect(ctx.entries.map((e) => e.path)).toEqual(['AGENTS.md']);
  });

  it('skills come from .agents/skills between site and root', async () => {
    const ctx = await resolve(
      {
        '.agents/skills/root-skill/SKILL.md': skill('root-skill', 'At the root'),
        'pkg/.agents/skills/pkg-skill/SKILL.md': skill('pkg-skill', 'In pkg'),
        'other/.agents/skills/other-skill/SKILL.md': skill('other-skill', 'Elsewhere'),
      },
      'pkg',
    );

    expect(ctx.entries.map((e) => [e.path, e.mode, e.catalogChars])).toEqual([
      ['.agents/skills/root-skill', 'listed', 'root-skill'.length + 'At the root'.length + '.agents/skills/root-skill'.length],
      ['pkg/.agents/skills/pkg-skill', 'listed', 'pkg-skill'.length + 'In pkg'.length + 'pkg/.agents/skills/pkg-skill'.length],
    ]);
    expect(ctx.notes).toEqual([]);
  });

  it('a CLAUDE.md-only repo gets the not-visible-to-Codex note', async () => {
    const ctx = await resolve({ 'CLAUDE.md': 'claude only', '.claude/skills/x/SKILL.md': skill('x', 'Claude-only skill') });

    expect(ctx.entries).toEqual([]);
    expect(ctx.notes).toEqual([
      'CLAUDE.md content not visible to Codex',
      'skill x not visible to Codex: .claude/skills is not scanned',
    ]);
  });

  it('a CLAUDE.md beside an AGENTS.md in the chain gets no note', async () => {
    const ctx = await resolve({ 'AGENTS.md': 'shared', 'CLAUDE.md': 'claude' });

    expect(ctx.notes).toEqual([]);
  });

  it('a skill mirrored into .agents/skills is visible to Codex', async () => {
    const ctx = await resolve({ '.claude/skills/x/SKILL.md': skill('x', 'Shared') }, '', { '.agents/skills/x': '.claude/skills/x' });

    expect(ctx.entries.map((e) => [e.path, e.unitId])).toEqual([['.agents/skills/x', 'skill/.claude/skills/x']]);
    expect(ctx.notes).toEqual([]);
  });

  it("a CRLF file's bytes equal its Buffer length", async () => {
    const ctx = await resolve({ 'AGENTS.md': 'a\r\nb\r\n' });

    expect(ctx.entries.map((e) => [e.bytes, e.loadedBytes])).toEqual([[6, 6]]);
  });
});

describe('contextSites', () => {
  it("returns '' plus every directory with an instructions unit", async () => {
    const { units } = await discoverUnits(
      memReader(
        {
          'pkg/AGENTS.md': 'pkg',
          'pkg/.claude/CLAUDE.md': 'pkg claude dir',
          '.claude/CLAUDE.md': 'root claude dir',
          'a/b/CLAUDE.local.md': 'local',
          '.agents/skills/s/SKILL.md': skill('s', 'not instructions'),
          'AGENTS.md': 'root',
        },
        { 'docs/CLAUDE.md': 'AGENTS.md' },
      ),
    );

    expect(contextSites(units)).toEqual(['', 'a/b', 'docs', 'pkg']);
  });
});
