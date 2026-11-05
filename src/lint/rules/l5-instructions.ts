import type { Finding, HarnessId } from '../../model.js';
import { maskCode } from '../../units/markdown.js';
import type { Rule } from '../types.js';

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const NAMES: Record<HarnessId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

export const instructionCount: Rule = {
  id: 'L5-instruction-count',
  async check({ reader, units, contexts, limits }) {
    const findings: Finding[] = [];
    const realPath = new Map(units.map((u) => [u.id, u.files[0]!.path]));
    // Keyed by path and loaded length: Codex may load only part of a file another site loads whole.
    const counts = new Map<string, number>();

    for (const { harness, site, entries } of contexts) {
      let total = 0;
      for (const { unitId, path, mode, loadedBytes } of entries) {
        if (mode !== 'always') continue;
        // An entry's path can be a symlink, which the reader never reads through.
        const file = realPath.get(unitId) ?? path;
        const key = `${file}\0${loadedBytes}`;
        let count = counts.get(key);
        if (count === undefined) {
          const text = (await reader.readFile(file)).subarray(0, loadedBytes).toString('utf8');
          count = maskCode(text)
            .split('\n')
            .filter((line) => LIST_ITEM.test(line)).length;
          counts.set(key, count);
        }
        total += count;
      }
      if (total > limits.alwaysOnInstructionItems) {
        const at = site === '' ? 'the repository root' : site;
        findings.push({
          rule: 'L5-instruction-count',
          severity: 'should',
          message: `${total} list items are always in ${NAMES[harness]}'s context at ${at}; models start dropping instructions past ${limits.alwaysOnInstructionItems}`,
        });
      }
    }
    return findings;
  },
};
