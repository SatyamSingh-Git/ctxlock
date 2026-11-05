import type { Finding } from '../../model.js';
import { maskCode } from '../../units/markdown.js';
import type { Rule } from '../types.js';

const TREE = /├──|└──|│ /;
const OVERVIEW = /^#{1,6}\s+(project|directory|repo(sitory)?|folder|codebase|file)\s+(structure|layout|overview|map|tree)\b/i;
const WHY = 'agents can list the files themselves';

export const discoverable: Rule = {
  id: 'L4-discoverable',
  check({ units, contexts }) {
    const findings: Finding[] = [];
    const always = new Set(contexts.flatMap((c) => c.entries.filter((e) => e.mode === 'always').map((e) => e.unitId)));
    for (const unit of units) {
      if (!always.has(unit.id)) continue;
      const report = (message: string, line: number, column: number) =>
        findings.push({ rule: 'L4-discoverable', severity: 'should', message, path: unit.path, line, column, unitId: unit.id });

      // Trees count inside code blocks too: that is where they are usually drawn.
      const lines = unit.text.split('\n');
      const tree = lines.flatMap((text, i) => (TREE.test(text) ? [i] : []));
      if (tree.length >= 3) {
        const first = lines[tree[0]!]!;
        const column = [...first.slice(0, first.search(TREE))].length + 1;
        report(`${tree.length}-line directory tree at ${tree[0]! + 1}:${column}; ${WHY}`, tree[0]! + 1, column);
      }

      maskCode(unit.text)
        .split('\n')
        .forEach((text, i) => {
          if (OVERVIEW.test(text)) report(`heading "${text.trim()}" at ${i + 1}:1 introduces a repository overview; ${WHY}`, i + 1, 1);
        });
    }
    return findings;
  },
};
