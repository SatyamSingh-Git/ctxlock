import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/model.js';
import { renderSarif } from '../../src/report/sarif.js';

const f = (rule: string, severity: Finding['severity'], path?: string, line?: number, column?: number, message = `${rule} at ${line ?? 0}:${column ?? 0}`): Finding => ({
  rule,
  severity,
  message,
  ...(path === undefined ? {} : { path }),
  ...(line === undefined ? {} : { line }),
  ...(column === undefined ? {} : { column }),
});
const sarif = (findings: Finding[], files = findings.map((x) => x.path ?? '')) => JSON.parse(renderSarif(findings, new Set(files), '9.9.9'));
const results = (log: { runs: Array<{ results: Array<Record<string, any>> }> }) => log.runs[0]!.results;

describe('renderSarif', () => {
  it('a must, a should and an info become one result each, with rules, levels and locations', () => {
    const log = sarif([f('L1-hidden-unicode', 'must', 'AGENTS.md', 3, 7), f('L9-stale', 'should', 'docs/My Rules.md', 2), f('L11-coverage', 'info', '.claude/rules/x.md')]);

    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json');
    expect(log.runs[0].tool.driver).toMatchObject({ name: 'ctxlock', version: '9.9.9', informationUri: 'https://github.com/SatyamSingh-Git/ctxlock' });
    expect(log.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(['L1-hidden-unicode', 'L9-stale', 'L11-coverage']);
    expect(log.runs[0].tool.driver.rules[1]).toMatchObject({
      helpUri: 'https://github.com/SatyamSingh-Git/ctxlock/blob/main/the-guide/rules.md',
      defaultConfiguration: { level: 'warning' },
    });
    expect(results(log).map((r) => [r.ruleId, r.level])).toEqual([
      ['L1-hidden-unicode', 'error'],
      ['L9-stale', 'warning'],
      ['L11-coverage', 'note'],
    ]);
    expect(results(log)[0]!.message).toEqual({ text: 'L1-hidden-unicode at 3:7' });
    expect(results(log)[0]!.locations).toEqual([{ physicalLocation: { artifactLocation: { uri: 'AGENTS.md', uriBaseId: '%SRCROOT%' }, region: { startLine: 3, startColumn: 7 } } }]);
    expect(results(log)[1]!.locations[0].physicalLocation.artifactLocation.uri).toBe('docs/My%20Rules.md');
    expect(results(log)[2]!.locations[0].physicalLocation).toEqual({ artifactLocation: { uri: '.claude/rules/x.md', uriBaseId: '%SRCROOT%' }, region: { startLine: 1 } });
  });

  it('findings with no file in the tree are left out', () => {
    expect(results(sarif([f('L10-owner', 'info'), f('L14-generated', 'should', 'AGENTS.md')], ['CLAUDE.md']))).toEqual([]);
  });

  it('identical findings get fingerprints ending :1 and :2, and a moved finding keeps its own', () => {
    const twice = results(sarif([f('L1-hidden-unicode', 'must', 'AGENTS.md', 3, 7), f('L1-hidden-unicode', 'must', 'AGENTS.md', 3, 7)]));
    const [one, two] = twice.map((r) => r.partialFingerprints.primaryLocationLineHash as string);

    expect(one).toMatch(/^[0-9a-f]{64}:1$/);
    expect(two).toBe(one!.replace(/:1$/, ':2'));

    const at = (line: number) => results(sarif([f('L9-stale', 'should', 'AGENTS.md', line)]))[0]!.partialFingerprints.primaryLocationLineHash;
    expect(at(3)).toBe(at(9));
    expect(results(sarif([f('L9-stale', 'should', 'AGENTS.md', 3, undefined, 'other text')]))[0]!.partialFingerprints.primaryLocationLineHash).not.toBe(at(3));
  });

  it('a control character in a message survives as JSON', () => {
    const message = `hook runs "x${String.fromCodePoint(0x1b)}[2J"`;

    expect(results(sarif([f('L2-exec-config', 'info', '.claude/settings.json', undefined, undefined, message)]))[0]!.message.text).toBe(message);
  });
});
