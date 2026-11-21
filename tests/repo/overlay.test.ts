import { describe, expect, it } from 'vitest';
import { overlayReader } from '../../src/repo/overlay.js';
import { FileNotFound } from '../../src/repo/reader.js';
import { memReader } from '../helpers/mem-reader.js';

describe('overlayReader', () => {
  it('the overlay leaves out a removed file and everything under a removed folder, and reads the rest', async () => {
    const base = memReader({
      'AGENTS.md': 'a\n',
      '.claude/rules/deps.md': 'npm\n',
      '.claude/skills/release/SKILL.md': 'skill\n',
      '.claude/skills/release/notes.md': 'notes\n',
      '.claude/skills/releases-old/SKILL.md': 'other\n',
    });

    const without = overlayReader(base, new Map(), new Set(['.claude/rules/deps.md', '.claude/skills/release']));

    expect(await without.listFiles()).toEqual(['.claude/skills/releases-old/SKILL.md', 'AGENTS.md']);
    await expect(without.readFile('.claude/skills/release/notes.md')).rejects.toBeInstanceOf(FileNotFound);
    expect([await without.exists('.claude/rules/deps.md'), await without.exists('.claude/skills/release'), await without.exists('AGENTS.md')]).toEqual([false, false, true]);
    expect((await without.readFile('.claude/skills/releases-old/SKILL.md')).toString()).toBe('other\n');
    // A file added inside a removed folder is there.
    const replaced = overlayReader(base, new Map([['.claude/rules/deps.md', Buffer.from('pnpm\n')]]), new Set(['.claude/rules']));
    expect((await replaced.readFile('.claude/rules/deps.md')).toString()).toBe('pnpm\n');
    // An added file still wins.
    expect((await overlayReader(base, new Map([['x.md', Buffer.from('x')]]), new Set(['AGENTS.md'])).listFiles())).toEqual(['.claude/rules/deps.md', '.claude/skills/release/SKILL.md', '.claude/skills/release/notes.md', '.claude/skills/releases-old/SKILL.md', 'x.md']);
  });
});
