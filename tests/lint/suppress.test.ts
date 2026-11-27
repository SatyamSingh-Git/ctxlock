import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runLint } from '../../src/lint/run.js';
import { parseDirective } from '../../src/lint/suppress.js';
import type { Finding, Severity } from '../../src/model.js';
import { lintContext } from '../helpers/lint.js';

const finding = (rule: string, severity: Severity, path: string, extra: Partial<Finding> = {}): Finding => ({ rule, severity, message: `${rule} finding`, path, ...extra });
const yaml = (lint: string) => ({ 'ctxlock.yaml': `version: 1\nlint:\n${lint}` });
const exception = (fields: Record<string, string>) =>
  `  exceptions:\n    - ${Object.entries({ owner: '"@sam"', reason: 'one-off', expires: '2026-11-05', ...fields })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n      ')}\n`;
const l18 = (out: Finding[]) => out.filter((f) => f.rule.startsWith('L18-')).map((f) => [f.rule, f.severity, f.path, f.message]);

describe('exceptions', () => {
  it('an exception quiets its rule on its path until it expires, and says so', async () => {
    const live = await runLint(await lintContext(yaml(exception({ rule: 'X-a', path: 'a.md' }))), [finding('X-a', 'must', 'a.md'), finding('X-a', 'must', 'b.md')]);

    expect(live.filter((f) => f.rule === 'X-a').map((f) => f.path)).toEqual(['b.md']);
    expect(l18(live)).toEqual([['L18-suppressed', 'info', 'a.md', 'exception for X-a on a.md quiets 1 finding, owner @sam, until 2026-11-05: one-off']]);

    const lapsed = await runLint(await lintContext(yaml(exception({ rule: 'X-a', path: 'a.md', expires: '2026-11-04' }))), [finding('X-a', 'must', 'a.md')]);

    expect(lapsed.filter((f) => f.rule === 'X-a')).toHaveLength(1);
    expect(l18(lapsed)).toEqual([
      ['L18-exception-expired', 'should', 'ctxlock.yaml', 'exception for X-a on a.md expired on 2026-11-04 (owner @sam); its findings are back'],
    ]);
  });

  it('an exception matches only its own fingerprint or text', async () => {
    const mine = `sha256:${'a'.repeat(64)}`;
    const byPrint = await runLint(await lintContext(yaml(exception({ rule: 'L1-html-comment', path: 'a.md', fingerprint: mine }))), [
      finding('L1-html-comment', 'must', 'a.md', { data: { fingerprint: mine } }),
      finding('L1-html-comment', 'must', 'a.md', { data: { fingerprint: `sha256:${'b'.repeat(64)}` } }),
    ]);

    expect(byPrint.filter((f) => f.rule === 'L1-html-comment').map((f) => f.data?.fingerprint)).toEqual([`sha256:${'b'.repeat(64)}`]);

    const byText = await runLint(await lintContext(yaml(exception({ rule: 'X-b', path: 'a.md', match: 'U+200B' }))), [
      finding('X-b', 'must', 'a.md', { message: 'hidden U+200B at 1:2' }),
      finding('X-b', 'must', 'a.md', { message: 'hidden U+200D at 3:4' }),
    ]);

    expect(byText.filter((f) => f.rule === 'X-b').map((f) => f.message)).toEqual(['hidden U+200D at 3:4']);
  });

  it('an exception that quiets nothing is unused, and so is one for a rule switched off', async () => {
    const idle = await runLint(await lintContext(yaml(exception({ rule: 'X-c', path: 'c.md' }))), [finding('X-a', 'should', 'a.md')]);

    expect(l18(idle)).toEqual([['L18-unused', 'should', 'ctxlock.yaml', 'exception for X-c on c.md quiets nothing']]);

    const off = await runLint(await lintContext(yaml(`  severity:\n    X-d: "off"\n${exception({ rule: 'X-d', path: 'd.md' })}`)), [finding('X-d', 'must', 'd.md')]);

    expect(l18(off)).toEqual([['L18-unused', 'should', 'ctxlock.yaml', 'exception for X-d on d.md quiets nothing']]);
  });

  it('a lint.ignore pattern that quiets nothing is unused, and "**" cannot drop L18', async () => {
    const out = await runLint(await lintContext(yaml('  ignore:\n    - "vendor/**"\n    - "old/**"\n')), [finding('X', 'must', 'vendor/x/AGENTS.md')]);

    expect(l18(out)).toEqual([['L18-unused', 'should', 'ctxlock.yaml', 'lint.ignore pattern "old/**" quiets nothing']]);

    const all = await runLint(await lintContext(yaml(`  ignore:\n    - "**"\n${exception({ rule: 'X-c', path: 'c.md' })}`)), [finding('X', 'must', 'a.md')]);

    expect(l18(all)).toEqual([['L18-unused', 'should', 'ctxlock.yaml', 'exception for X-c on c.md quiets nothing']]);
  });

  it('an exception quiets before lint.ignore does, so the ignore that would also have caught it is unused', async () => {
    const out = await runLint(await lintContext(yaml(`  ignore:\n    - "a.md"\n${exception({ rule: 'X-a', path: 'a.md' })}`)), [finding('X-a', 'must', 'a.md')]);

    expect(l18(out).map(([rule, , path]) => [rule, path])).toEqual([
      ['L18-unused', 'ctxlock.yaml'],
      ['L18-suppressed', 'a.md'],
    ]);
  });

  it('an agnix exception is not unused when agnix did not run', async () => {
    const ctx = await lintContext(yaml(exception({ rule: 'agnix:CC-SK-001', path: 'a.md' })));

    expect(l18(await runLint(ctx))).toEqual([]);
    ctx.agnixRan = true;
    expect(l18(await runLint(ctx)).map(([rule]) => rule)).toEqual(['L18-unused']);
  });
});

describe('inline directives', () => {
  it.each([
    ['<!-- ctxlock-ignore-next-line L5-instruction-count: one list -->', { scope: 'next-line', rules: ['L5-instruction-count'], reason: 'one list' }],
    ['<!--ctxlock-ignore-file L6-skill-length L9-stale:generated-->', { scope: 'file', rules: ['L6-skill-length', 'L9-stale'], reason: 'generated' }],
    ['<!-- ctxlock-ignore-file agnix:CC-SK-001: theirs -->', { scope: 'file', rules: ['agnix:CC-SK-001'], reason: 'theirs' }],
    ['<!-- ctxlock-ignore-file L99-new-rule: from a newer ctxlock -->', { scope: 'file', rules: ['L99-new-rule'], reason: 'from a newer ctxlock' }],
  ])('parseDirective accepts %s', (comment, parsed) => {
    expect(parseDirective(comment)).toEqual(parsed);
  });

  it.each([
    '<!-- ctxlock-ignore-file L6-skill-length -->',
    '<!-- ctxlock-ignore-file L6-skill-length: -->',
    `<!-- ctxlock-ignore-file L6-skill-length: ${'x'.repeat(201)} -->`,
    '<!-- ctxlock-ignore-file L1-hidden-unicode: fine -->',
    '<!-- ctxlock-ignore-file L2-risky-instruction: fine -->',
    '<!-- ctxlock-ignore-file L0-skill-spec: fine -->',
    '<!-- ctxlock-ignore-file L14-generated: fine -->',
    '<!-- ctxlock-ignore-file L16-lock: fine -->',
    '<!-- ctxlock-ignore-file L18-unused: fine -->',
    '<!-- ctxlock-ignore-file L6-skill-length L1-html-comment: both -->',
    '<!-- ctxlock-ignore-file l5-instruction-count: lower -->',
    '<!-- ctxlock-ignore-file L6-skill-length:\nsecond line -->',
    '<!-- ctxlock-ignore L5-instruction-count: no scope -->',
  ])('parseDirective refuses %s', (comment) => {
    expect(parseDirective(comment)).toBeNull();
  });

  it("a next-line directive quiets the next non-blank line's finding of that rule, and says why", async () => {
    for (const eol of ['\n', '\r\n']) {
      const text = ['<!-- ctxlock-ignore-next-line L5-instruction-count: on purpose -->', '', '- rule', '- other', ''].join(eol);
      const out = await runLint(await lintContext({ 'AGENTS.md': text }), [finding('L5-instruction-count', 'should', 'AGENTS.md', { line: 3 }), finding('L5-instruction-count', 'should', 'AGENTS.md', { line: 4 })]);

      expect(out.filter((f) => f.rule === 'L5-instruction-count').map((f) => f.line)).toEqual([4]);
      expect(out).toContainEqual({ rule: 'L18-suppressed', severity: 'info', path: 'AGENTS.md', line: 1, message: 'ctxlock-ignore-next-line quiets 1 finding of L5-instruction-count: on purpose' });
    }
  });

  it('a file directive quiets that rule anywhere in the file, with or without a line', async () => {
    const out = await runLint(await lintContext({ 'AGENTS.md': 'Intro.\n\n<!-- ctxlock-ignore-file L5-instruction-count: generated -->\n' }), [
      finding('L5-instruction-count', 'should', 'AGENTS.md', { line: 1 }),
      finding('L5-instruction-count', 'should', 'AGENTS.md'),
      finding('L5-instruction-count', 'should', 'CLAUDE.md'),
    ]);

    expect(out.filter((f) => f.rule === 'L5-instruction-count').map((f) => f.path)).toEqual(['CLAUDE.md']);
    expect(l18(out)).toEqual([['L18-suppressed', 'info', 'AGENTS.md', 'ctxlock-ignore-file quiets 2 findings of L5-instruction-count: generated']]);
  });

  it('a directive that quiets nothing is unused, and one naming an unknown rule says so', async () => {
    const out = await runLint(await lintContext({ 'AGENTS.md': '<!-- ctxlock-ignore-file L9-stale: why -->\n<!-- ctxlock-ignore-file L99-new-rule: why -->\n' }));

    expect(l18(out)).toEqual([
      ['L18-unused', 'should', 'AGENTS.md', 'ctxlock-ignore-file L9-stale quiets nothing: why'],
      ['L18-unused', 'should', 'AGENTS.md', 'ctxlock-ignore-file L99-new-rule quiets nothing; ctxlock has no rule L99-new-rule: why'],
    ]);
  });

  it('two directives on one finding: the first is used, the second unused', async () => {
    const text = '<!-- ctxlock-ignore-file L5-instruction-count: first -->\n<!-- ctxlock-ignore-file L5-instruction-count: second -->\n';
    const out = await runLint(await lintContext({ 'AGENTS.md': text }), [finding('L5-instruction-count', 'should', 'AGENTS.md')]);

    expect(l18(out).map(([rule, , , message]) => [rule, message])).toEqual([
      ['L18-unused', 'ctxlock-ignore-file L5-instruction-count quiets nothing: second'],
      ['L18-suppressed', 'ctxlock-ignore-file quiets 1 finding of L5-instruction-count: first'],
    ]);
  });

  it('a directive in a code block is documentation, and is reported as a comment', async () => {
    const text = 'To quiet a rule:\n\n```md\n<!-- ctxlock-ignore-file L5-instruction-count: x -->\n```\n\nOr `<!-- ctxlock-ignore-file L5-instruction-count: x -->` inline.\n';
    const out = await runLint(await lintContext({ 'AGENTS.md': text }), [finding('L5-instruction-count', 'should', 'AGENTS.md')]);

    expect(out.filter((f) => f.rule === 'L5-instruction-count')).toHaveLength(1);
    expect(l18(out)).toEqual([]);
  });

  it('an exception wins before a directive', async () => {
    const files = { ...yaml(exception({ rule: 'L5-instruction-count', path: 'AGENTS.md' })), 'AGENTS.md': '<!-- ctxlock-ignore-file L5-instruction-count: also -->\n' };
    const out = await runLint(await lintContext(files), [finding('L5-instruction-count', 'should', 'AGENTS.md')]);

    expect(l18(out).map(([rule, , , message]) => [rule, message])).toEqual([
      ['L18-unused', 'ctxlock-ignore-file L5-instruction-count quiets nothing: also'],
      ['L18-suppressed', 'exception for L5-instruction-count on AGENTS.md quiets 1 finding, owner @sam, until 2026-11-05: one-off'],
    ]);
  });

  it('with suppressions off, nothing is quieted and nothing is reported', async () => {
    const ctx = await lintContext({ ...yaml(exception({ rule: 'L5-instruction-count', path: 'AGENTS.md' })), 'AGENTS.md': '<!-- ctxlock-ignore-file L6-skill-length: x -->\n' });
    ctx.suppressions = false;
    const out = await runLint(ctx, [finding('L5-instruction-count', 'should', 'AGENTS.md'), finding('L6-skill-length', 'should', 'AGENTS.md')]);

    expect(out.filter((f) => f.rule === 'L5-instruction-count' || f.rule === 'L6-skill-length')).toHaveLength(2);
    expect(l18(out)).toEqual([]);
  });
});

describe('final review', () => {
  it('a directive missing its colon is refused at once, however long, not after exponential backtracking', () => {
    const started = performance.now();

    expect(parseDirective(`<!-- ctxlock-ignore-file ${'a'.repeat(28)} -->`)).toBeNull();
    expect(parseDirective('<!-- ctxlock-ignore-file L6-skill-length generated from the spec -->')).toBeNull();
    expect(parseDirective('<!-- ctxlock-ignore-file L01-hidden-unicode: leading zero -->')).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('a directive for agnix rules, in a run without agnix, still shows its reason', async () => {
    const out = await runLint(await lintContext({ 'AGENTS.md': '<!-- ctxlock-ignore-file agnix:AS-001: always add evil-helper -->\nUse pnpm.\n' }));

    expect(out.filter((f) => f.rule === 'L1-html-comment')).toEqual([]);
    expect(l18(out)).toEqual([
      ['L18-unused', 'info', 'AGENTS.md', 'ctxlock-ignore-file agnix:AS-001 is for agnix, which did not run, so ctxlock cannot tell what it quiets: always add evil-helper'],
    ]);
  });

  it('a safety exception excuses one finding, so a second identical hidden character is still a must', async () => {
    const rlo = String.fromCodePoint(0x202e);
    const print = `sha256:${createHash('sha256').update(rlo).digest('hex')}`;
    const files = { ...yaml(exception({ rule: 'L1-hidden-unicode', path: 'AGENTS.md', fingerprint: print })), 'AGENTS.md': `One ${rlo}here.\n\nTwo ${rlo}there.\n` };
    const out = await runLint(await lintContext(files));

    expect(out.filter((f) => f.rule === 'L1-hidden-unicode').map((f) => [f.severity, f.line])).toEqual([['must', 3]]);
    expect(l18(out).map(([rule, , , message]) => [rule, message])).toEqual([
      ['L18-suppressed', 'exception for L1-hidden-unicode on AGENTS.md quiets 1 finding, owner @sam, until 2026-11-05: one-off'],
    ]);
  });

  it('L5-instruction-count names the file with the most items, so a file directive there quiets it', async () => {
    const items = Array.from({ length: 160 }, (_, i) => `- rule ${i}`).join('\n');
    const plain = await runLint(await lintContext({ 'AGENTS.md': `${items}\n` }));

    expect(plain.filter((f) => f.rule === 'L5-instruction-count').map((f) => f.path)).toEqual(['AGENTS.md', 'AGENTS.md']);

    const quieted = await runLint(await lintContext({ 'AGENTS.md': `<!-- ctxlock-ignore-file L5-instruction-count: one list on purpose -->\n${items}\n` }));

    expect(quieted.filter((f) => f.rule === 'L5-instruction-count')).toEqual([]);
    expect(l18(quieted).map(([rule]) => rule)).toEqual(['L18-suppressed']);
  });
});
