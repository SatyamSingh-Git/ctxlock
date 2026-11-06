import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { cleanup, tempDir, writeTree } from './helpers/repo.js';

afterAll(cleanup);

async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

describe('ctxlock CLI', () => {
  it('lint exits 1 on a repo containing U+200B and 0 after it is removed', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': `Use pnpm.${String.fromCodePoint(0x200b)}\n` });

    const flagged = await cli('lint', dir);
    expect(flagged.code).toBe(1);
    expect(flagged.stdout).toContain('L1-hidden-unicode');
    expect((await cli('scan', dir)).code).toBe(0);
    expect((await cli('budget', dir)).code).toBe(0);

    writeTree(dir, { 'AGENTS.md': 'Use pnpm.\n' });
    expect((await cli('lint', dir)).code).toBe(0);
  });

  it('lint exits 2 and prints the RegistryError message for an invalid ctxlock.yaml', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', 'ctxlock.yaml': 'version: 2\n' });

    const { code, stdout, stderr } = await cli('lint', dir);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/^ctxlock\.yaml: version: /);
  });

  it('an unexpected error exits 2 with its message and no stack trace, never 1, which means must-fix', async () => {
    const dir = tempDir();
    const deep = `${'['.repeat(20000)}${']'.repeat(20000)}`;
    writeTree(dir, { 'AGENTS.md': 'a', '.claude/settings.json': `{ "env": { "X": ${deep} } }` });

    const { code, stderr } = await cli('lint', dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^ctxlock could not run: /);
    expect(stderr).not.toMatch(/\n\s+at /);
  });

  it('bad arguments exit 2', async () => {
    const dir = tempDir();

    expect((await cli('lint', dir, '--format', 'xml')).code).toBe(2);
    expect((await cli('lint', join(dir, 'missing'))).code).toBe(2);
    expect((await cli('frobnicate')).code).toBe(2);
    expect((await cli('lint', '--help')).code).toBe(0);
  });

  it('--format json never contains unit text', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'The sentinel phrase is purple-elephant-42.\n', '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: Writes notes\n---\nsecret-steps-17\n' });

    for (const view of ['scan', 'lint', 'budget']) {
      const { code, stdout } = await cli(view, dir, '--format', 'json');
      expect(code).toBe(0);
      expect(stdout).not.toMatch(/purple-elephant-42|secret-steps-17/);
      expect(JSON.parse(stdout)).toMatchObject({ version: 1, root: dir, ref: null });
    }
    const json = async (view: string) => JSON.parse((await cli(view, dir, '--format', 'json')).stdout);
    const scan = await json('scan');
    expect(Object.keys(scan)).toEqual(['version', 'root', 'ref', 'units', 'contexts', 'budget', 'findings']);
    expect(Object.keys(await json('lint'))).toEqual(['version', 'root', 'ref', 'findings']);
    expect(Object.keys(await json('budget'))).toEqual(['version', 'root', 'ref', 'budget']);
    expect(Object.keys(scan.units[0])).toEqual(['id', 'kind', 'path', 'name', 'digest', 'aliases']);
  });

  it('budget prints one row per site and harness', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a'.repeat(100), 'pkg/AGENTS.md': 'b'.repeat(50) });

    const lines = (await cli('budget', dir)).stdout.trimEnd().split('\n');
    expect(lines).toEqual([
      expect.stringMatching(/^harness\s+site\s+always bytes\s+skill catalog\s+cut$/),
      expect.stringMatching(/^claude-code\s+\.\s+100\s+0\s+-$/),
      expect.stringMatching(/^claude-code\s+pkg\s+150\s+0\s+-$/),
      expect.stringMatching(/^codex\s+\.\s+100 \/ 32768\s+0 \/ 8000\s+-$/),
      expect.stringMatching(/^codex\s+pkg\s+150 \/ 32768\s+0 \/ 8000\s+-$/),
    ]);
  });

  it('scan lists the units, what each agent loads, and a count of findings', async () => {
    const dir = tempDir();
    writeTree(dir, { 'AGENTS.md': 'a', '.claude/rules/style.md': 'Use tabs.' });

    const { code, stdout } = await cli('scan', dir);
    expect(code).toBe(0);
    expect(stdout).toContain('2 units');
    expect(stdout).toMatch(/instructions\s+AGENTS\.md/);
    expect(stdout).toMatch(/rule\s+\.claude\/rules\/style\.md/);
    expect(stdout).toMatch(/claude-code at \.: 2 always/);
    expect(stdout).toMatch(/codex at \.: 1 always/);
    expect(stdout).toMatch(/findings: 0 must, 0 should, \d+ info/);
  });
});
