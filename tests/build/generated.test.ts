import { describe, expect, it } from 'vitest';
import { GENERATED_FILE, type GeneratedFile, generatedStatus, loadGenerated, serializeGenerated } from '../../src/build/generated.js';
import { runLint } from '../../src/lint/run.js';
import { sha256Hex } from '../../src/units/digest.js';
import { lintContext } from '../helpers/lint.js';
import { memReader } from '../helpers/mem-reader.js';

const SOURCE = '.agents/skills/r/SKILL.md';
const OUTPUT = '.claude/skills/r/SKILL.md';
const copy: GeneratedFile = { path: OUTPUT, sha256: sha256Hex('skill'), from: [{ path: SOURCE, sha256: sha256Hex('skill') }] };
const record = (...files: GeneratedFile[]) => ({ [GENERATED_FILE]: serializeGenerated(files) });

describe('loadGenerated and serializeGenerated', () => {
  it('reads no files when there is no record', async () => {
    expect(await loadGenerated(memReader({}))).toEqual({ files: [], error: null });
  });

  it('writes sorted, two-space JSON with a trailing newline, which reads back the same', async () => {
    const root = { path: 'AGENTS.md', sha256: sha256Hex('x'), from: [] };
    const text = serializeGenerated([root, copy]);

    expect(text).toBe(`${JSON.stringify({ version: 1, files: [copy, root] }, null, 2)}\n`);
    expect(await loadGenerated(memReader({ [GENERATED_FILE]: text }))).toEqual({ files: [copy, root], error: null });
  });

  it.each([
    ['another version', JSON.stringify({ version: 2, files: [] }), /version/],
    ['text that is not JSON', '{', /JSON/],
    ['a path that climbs out', JSON.stringify({ version: 1, files: [{ ...copy, path: '../x' }] }), /\.\.\/x/],
    ['an absolute path', JSON.stringify({ version: 1, files: [{ ...copy, path: '/etc/x' }] }), /\/etc\/x/],
    ['a drive letter', JSON.stringify({ version: 1, files: [{ ...copy, path: 'C:/x' }] }), /C:\/x/],
    ['a backslash', JSON.stringify({ version: 1, files: [{ ...copy, path: 'a\\b' }] }), /a\\b/],
    ['a source outside', JSON.stringify({ version: 1, files: [{ ...copy, from: [{ path: '../s', sha256: 'x' }] }] }), /\.\.\/s/],
  ])('rejects %s, reading no files', async (_name, text, error) => {
    const r = await loadGenerated(memReader({ [GENERATED_FILE]: text }));
    expect(r.files).toEqual([]);
    expect(r.error).toMatch(error);
  });
});

describe('generatedStatus', () => {
  const state = async (files: Record<string, string>, entry = copy) => generatedStatus(memReader(files), [entry]);

  it('says ok, missing, edited, source-missing or stale, checked in that order', async () => {
    expect(await state({ [SOURCE]: 'skill', [OUTPUT]: 'skill' })).toEqual([{ path: OUTPUT, state: 'ok' }]);
    expect(await state({})).toEqual([{ path: OUTPUT, state: 'missing' }]);
    expect(await state({ [SOURCE]: 'changed', [OUTPUT]: 'changed' })).toEqual([{ path: OUTPUT, state: 'edited' }]);
    expect(await state({ [OUTPUT]: 'skill' })).toEqual([{ path: OUTPUT, state: 'source-missing', source: SOURCE }]);
    expect(await state({ [SOURCE]: 'changed', [OUTPUT]: 'skill' })).toEqual([{ path: OUTPUT, state: 'stale', source: SOURCE }]);
  });

  it('agrees across an LF checkout and a CRLF one, as unit digests do, so Windows and Linux read one record alike', async () => {
    const lf = { path: OUTPUT, sha256: sha256Hex('a\nb\n'), from: [{ path: SOURCE, sha256: sha256Hex('a\nb\n') }] };
    expect(await state({ [SOURCE]: 'a\r\nb\r\n', [OUTPUT]: 'a\r\nb\r\n' }, lf)).toEqual([{ path: OUTPUT, state: 'ok' }]);
    expect(await state({ [SOURCE]: 'a\nb\n', [OUTPUT]: 'a\r\nb\r\n' }, lf)).toEqual([{ path: OUTPUT, state: 'ok' }]);
    expect(await state({ [SOURCE]: 'a\nc\n', [OUTPUT]: 'a\r\nb\r\n' }, lf)).toEqual([{ path: OUTPUT, state: 'stale', source: SOURCE }]);
  });

  it('never calls a file stale that was made from no source', async () => {
    const stub = { path: 'pkg/CLAUDE.md', sha256: sha256Hex('@AGENTS.md\n'), from: [] };
    expect(await state({ 'pkg/CLAUDE.md': '@AGENTS.md\n' }, stub)).toEqual([{ path: 'pkg/CLAUDE.md', state: 'ok' }]);
  });
});

describe('L14-generated', () => {
  const lint = async (files: Record<string, string>) =>
    (await runLint(await lintContext(files))).filter((f) => f.rule === 'L14-generated').map((f) => [f.severity, f.path, f.message]);

  it('reports each generated file that is missing, edited, orphaned or out of date', async () => {
    expect(await lint({ [SOURCE]: 'skill', [OUTPUT]: 'skill', ...record(copy) })).toEqual([]);
    expect(await lint({ [SOURCE]: 'skill', ...record(copy) })).toEqual([
      ['should', OUTPUT, `${OUTPUT} is listed in .ctxlock/generated.json but missing; run ctxlock build --fill-missing, or remove the entry`],
    ]);
    expect(await lint({ [SOURCE]: 'skill', [OUTPUT]: 'mine', ...record(copy) })).toEqual([
      ['should', OUTPUT, `${OUTPUT} was edited after ctxlock generated it; edit its source instead, or remove the entry to keep the edit`],
    ]);
    expect(await lint({ [OUTPUT]: 'skill', ...record(copy) })).toEqual([['should', OUTPUT, `${OUTPUT} was generated from ${SOURCE}, which no longer exists`]]);
    expect(await lint({ [SOURCE]: 'newer', [OUTPUT]: 'skill', ...record(copy) })).toEqual([
      ['should', OUTPUT, `${OUTPUT} is out of date: ${SOURCE} changed since it was generated; run ctxlock build --fill-missing`],
    ]);
  });

  it('reports a record it cannot read', async () => {
    expect(await lint({ [GENERATED_FILE]: '{' })).toEqual([['should', GENERATED_FILE, expect.stringMatching(/^\.ctxlock\/generated\.json is not valid: .*JSON/)]]);
  });
});
