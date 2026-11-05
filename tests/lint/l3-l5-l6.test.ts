import { describe, expect, it } from 'vitest';
import { harnessBudget } from '../../src/lint/rules/l3-budget.js';
import { instructionCount } from '../../src/lint/rules/l5-instructions.js';
import { skillLength } from '../../src/lint/rules/l6-skill-length.js';
import type { Rule } from '../../src/lint/types.js';
import { lintContext } from '../helpers/lint.js';

async function run(rule: Rule, files: Record<string, string>) {
  return (await rule.check(await lintContext(files))).map((f) => [f.severity, f.path, f.message]);
}

const skill = (name: string, fields: Record<string, string>, body = 'Steps.\n') =>
  `---\nname: ${name}\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n${body}`;

describe('L3-budget', () => {
  it('chain totals of 32768 vs 32769 bytes', async () => {
    const chain = (bytes: number) => ({ 'AGENTS.md': 'a'.repeat(11000), 'pkg/AGENTS.md': 'b'.repeat(11000), 'pkg/sub/AGENTS.md': 'c'.repeat(bytes - 22000) });

    expect(await run(harnessBudget, chain(32768))).toEqual([]);
    expect(await run(harnessBudget, chain(32769))).toEqual([
      ['should', 'pkg/sub/AGENTS.md', 'AGENTS.md chain at pkg/sub is 32769 bytes; Codex loads the first 32768 (pkg/sub/AGENTS.md cut)'],
    ]);
  });

  it('a file the budget runs out before is reported as dropped', async () => {
    const findings = await run(harnessBudget, { 'AGENTS.md': 'a'.repeat(32768), 'pkg/AGENTS.md': 'b' });

    expect(findings.filter(([severity]) => severity === 'should')).toEqual([
      ['should', 'pkg/AGENTS.md', 'AGENTS.md chain at pkg is 32769 bytes; Codex loads the first 32768 (pkg/AGENTS.md dropped)'],
    ]);
  });

  it('a file Claude Code loads on demand over 40000 characters is capped, once however many sites load it', async () => {
    const files = (chars: number) => ({
      'CLAUDE.md': 'root\n@docs/notes.md\n',
      'docs/notes.md': 'Notes that are not a unit of their own.',
      'pkg/CLAUDE.md': 'pkg',
      '.claude/rules/api.md': `---\npaths: ["src/**"]\n---\n${'r'.repeat(chars - 26)}`,
    });

    expect(await run(harnessBudget, files(40000))).toEqual([]);
    expect(await run(harnessBudget, files(40001))).toEqual([
      ['should', '.claude/rules/api.md', '.claude/rules/api.md is 40001 characters; Claude Code reads only the first 40000 when it loads the file on demand'],
    ]);
  });

  it('a small on-demand file with a byte-order mark, or not in UTF-8, is not reported as capped', async () => {
    const ctx = await lintContext({
      'CLAUDE.md': 'root',
      'pkg/CLAUDE.md': `${String.fromCodePoint(0xfeff)}# pkg\nsmall\n`,
      '.claude/rules/latin1.md': Buffer.concat([Buffer.from('---\npaths: ["src/**"]\n---\ncaf'), Buffer.from([0xe9])]),
    });

    expect(await harnessBudget.check(ctx)).toEqual([]);
    expect(ctx.contexts[0]!.entries.filter((e) => e.loadedBytes < e.bytes && e.catalogChars === undefined)).toEqual([]);
  });

  it('entries of 1536 vs 1537 chars', async () => {
    const files = (whenToUse: number, dir = '.claude/skills') => ({
      [`${dir}/deploy/SKILL.md`]: skill('deploy', { description: 'd'.repeat(1000), when_to_use: 'w'.repeat(whenToUse) }),
    });

    expect(await run(harnessBudget, files(536))).toEqual([]);
    expect(await run(harnessBudget, files(537))).toEqual([
      ['should', '.claude/skills/deploy/SKILL.md', 'skill deploy: description and when_to_use are 1537 characters; Claude Code cuts each skill listing entry at 1536'],
    ]);
    expect(await run(harnessBudget, files(537, '.agents/skills'))).toEqual([]);
  });

  it('a claude-only skill-entry finding is suppressed when ctxlock.yaml lists harnesses [codex]', async () => {
    expect(
      await run(harnessBudget, {
        'ctxlock.yaml': 'version: 1\nharnesses: [codex]\n',
        '.claude/skills/deploy/SKILL.md': skill('deploy', { description: 'd'.repeat(1000), when_to_use: 'w'.repeat(537) }),
      }),
    ).toEqual([]);
  });

  it('descriptions of 1000 vs 1001 chars (info)', async () => {
    const files = (chars: number) => ({ '.agents/skills/deploy/SKILL.md': skill('deploy', { description: 'd'.repeat(chars) }) });

    expect(await run(harnessBudget, files(1000))).toEqual([]);
    expect(await run(harnessBudget, files(1001))).toEqual([
      ['info', '.agents/skills/deploy/SKILL.md', 'skill deploy: description is 1001 characters; some clients cut descriptions at 1000'],
    ]);
    expect(await run(harnessBudget, files(1025))).toEqual([]);
    // Counted in code points, as L0 counts the 1024 limit: 1001 of them are 2002 UTF-16 units.
    expect(await run(harnessBudget, { '.agents/skills/deploy/SKILL.md': skill('deploy', { description: String.fromCodePoint(0x1d49f).repeat(1001) }) })).toEqual([
      ['info', '.agents/skills/deploy/SKILL.md', 'skill deploy: description is 1001 characters; some clients cut descriptions at 1000'],
    ]);
  });

  it('catalogs of 8000 vs 8001 chars', async () => {
    // Each skill counts its name (2), its path .agents/skills/sN (17) and its description.
    const catalog = (total: number) =>
      Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `.agents/skills/s${i + 1}/SKILL.md`,
          skill(`s${i + 1}`, { description: 'd'.repeat(981 + (i === 0 ? total - 8000 : 0)) }),
        ]),
      );

    expect(await run(harnessBudget, catalog(8000))).toEqual([]);
    expect(await run(harnessBudget, catalog(8001))).toEqual([
      ['should', undefined, 'Codex skill catalog at the repository root is 8001 characters, over the 8000 Codex gives it'],
    ]);
  });

  it('an AGENTS.md of 16384 vs 16385 bytes (info), and an AGENTS.override.md is not checked', async () => {
    expect(await run(harnessBudget, { 'AGENTS.md': 'a'.repeat(16384) })).toEqual([]);
    expect(await run(harnessBudget, { 'AGENTS.md': 'a'.repeat(16385) })).toEqual([
      ['info', 'AGENTS.md', "AGENTS.md is 16385 bytes; Devin's cloud agent reads only the first 16384"],
    ]);
    expect(await run(harnessBudget, { 'AGENTS.override.md': 'a'.repeat(16385) })).toEqual([]);
  });
});

describe('L5-instruction-count', () => {
  const STYLES = ['- ', '* ', '+ ', '1. ', '2) ', '  - '];
  const items = (n: number) => Array.from({ length: n }, (_, i) => `${STYLES[i % STYLES.length]}rule ${i + 1}`).join('\n');
  const notItems = ['Plain text', '-flag', '1.5 kg', '---', '*emphasis*'].join('\n');

  it('150 vs 151 list items', async () => {
    expect(
      await run(instructionCount, {
        'AGENTS.md': `${items(150)}\n${notItems}\n`,
        // Loaded only when the agent touches src/, so not always in context.
        '.claude/rules/api.md': `---\npaths: ["src/**"]\n---\n${items(10)}\n`,
      }),
    ).toEqual([]);
    expect(await run(instructionCount, { 'AGENTS.md': `${items(151)}\n${notItems}\n` })).toEqual([
      ['should', undefined, "151 list items are always in Claude Code's context at the repository root; models start dropping instructions past 150"],
      ['should', undefined, "151 list items are always in Codex's context at the repository root; models start dropping instructions past 150"],
    ]);
  });

  it('list items inside a fence are not counted', async () => {
    expect(await run(instructionCount, { 'AGENTS.md': `${items(150)}\n\n\`\`\`md\n${items(5)}\n\`\`\`\n` })).toEqual([]);
  });

  it('counts across every file loaded at launch, imports included', async () => {
    expect(
      await run(instructionCount, {
        'CLAUDE.md': `${items(100)}\n@docs/more.md\n`,
        'docs/more.md': items(30),
        '.claude/rules/style.md': items(21),
      }),
    ).toEqual([['should', undefined, "151 list items are always in Claude Code's context at the repository root; models start dropping instructions past 150"]]);
  });

  it('a CLAUDE.md symlinked to AGENTS.md is read through the file it points to', async () => {
    const findings = await instructionCount.check(await lintContext({ 'AGENTS.md': items(151) }, { 'CLAUDE.md': 'AGENTS.md' }));

    expect(findings.map((f) => f.message)).toEqual([
      "151 list items are always in Claude Code's context at the repository root; models start dropping instructions past 150",
      "151 list items are always in Codex's context at the repository root; models start dropping instructions past 150",
    ]);
  });

  it('Codex counts only the part of a file it loads', async () => {
    expect(await run(instructionCount, { 'AGENTS.md': `${'x'.repeat(32760)}\n${items(151)}\n` })).toEqual([
      ['should', undefined, "151 list items are always in Claude Code's context at the repository root; models start dropping instructions past 150"],
    ]);
  });
});

describe('L6-skill-length', () => {
  const files = (body: string) => ({ '.agents/skills/deploy/SKILL.md': skill('deploy', { description: 'Deploys' }, body) });
  const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `Step ${i + 1}`).join('\n')}\n`;

  it('skill bodies of 500 vs 501 lines and 20000 vs 20001 chars', async () => {
    expect(await run(skillLength, files(lines(500)))).toEqual([]);
    expect(await run(skillLength, files(lines(501)))).toEqual([['should', '.agents/skills/deploy/SKILL.md', 'skill deploy: SKILL.md body is 501 lines (limit 500)']]);
    expect(await run(skillLength, files('x'.repeat(20000)))).toEqual([]);
    expect(await run(skillLength, files(String.fromCodePoint(0x1d49f).repeat(10001)))).toEqual([]);
    expect(await run(skillLength, { ...files('Steps.\n'), 'AGENTS.md': lines(600) })).toEqual([]);
    expect(await run(skillLength, files('x'.repeat(20001)))).toEqual([
      ['should', '.agents/skills/deploy/SKILL.md', 'skill deploy: SKILL.md body is 20001 characters (limit 20000, about 5,000 tokens)'],
    ]);
  });
});
