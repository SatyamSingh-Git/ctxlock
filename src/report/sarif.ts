import { createHash } from 'node:crypto';
import { findingKey } from '../diff.js';
import type { Finding } from '../model.js';

const LEVEL = { must: 'error', should: 'warning', info: 'note' } as const;
const RULES_PAGE = 'https://github.com/SatyamSingh-Git/ctxlock/blob/main/the-guide/rules.md';

// One SARIF 2.1.0 run of lint's findings, for GitHub code scanning and the VS Code SARIF viewer.
// A finding with no file in the tree is left out: code scanning drops a result without a real location,
// and pointing it at another file would say something false.
export function renderSarif(findings: Finding[], files: ReadonlySet<string>, version: string): string {
  const located = findings.filter((f) => f.path !== undefined && files.has(f.path));
  const rules = new Map<string, Finding['severity']>();
  for (const f of located) if (!rules.has(f.rule)) rules.set(f.rule, f.severity);

  // An alert is the same alert across commits when diff would call the finding old and it is in the same
  // file: diff keys a skill's findings by the skill, but each file is its own place for code scanning, so
  // fixing one file must not renumber another's. Identical findings in one file stay apart by their order.
  const seen = new Map<string, number>();
  const results = located.map((f) => {
    const hash = createHash('sha256').update(`${findingKey(f)}|${f.path}`).digest('hex');
    const n = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, n);
    return {
      ruleId: f.rule,
      level: LEVEL[f.severity],
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.path!.split('/').map(encodeURIComponent).join('/'), uriBaseId: '%SRCROOT%' },
            region: { startLine: f.line ?? 1, ...(f.column === undefined ? {} : { startColumn: f.column }) },
          },
        },
      ],
      partialFingerprints: { primaryLocationLineHash: `${hash}:${n}` },
    };
  });

  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ctxlock',
            version,
            informationUri: 'https://github.com/SatyamSingh-Git/ctxlock',
            rules: [...rules].map(([id, severity]) => ({
              id,
              shortDescription: { text: id },
              fullDescription: { text: `${id}: what it checks and how to fix a finding are in ${RULES_PAGE}` },
              help: { text: `See ${RULES_PAGE}` },
              helpUri: RULES_PAGE,
              defaultConfiguration: { level: LEVEL[severity] },
            })),
          },
        },
        // ctxlock counts columns in code points, not the UTF-16 units SARIF readers otherwise assume.
        columnKind: 'unicodeCodePoints',
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
