import { describe, expect, it } from 'vitest';
import { runLint } from '../../src/lint/run.js';
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
