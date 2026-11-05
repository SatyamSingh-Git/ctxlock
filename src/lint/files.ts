import type { Unit } from '../model.js';
import type { LintContext } from './types.js';

// ignoreBOM keeps a leading BOM in the text, so L1 can allow it at offset 0 and flag it anywhere else.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Each text file of each unit, once. Files that are not UTF-8, such as images in a skill, are skipped.
export async function* textFiles({ reader, units }: LintContext): AsyncGenerator<{ unit: Unit; path: string; text: string }> {
  const seen = new Set<string>();
  for (const unit of units) {
    for (const { path } of unit.files) {
      if (seen.has(path)) continue;
      seen.add(path);
      const buf = await reader.readFile(path);
      let text: string;
      try {
        text = utf8.decode(buf);
      } catch {
        continue;
      }
      yield { unit, path, text };
    }
  }
}

export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: [...before.slice(lineStart)].length + 1 };
}

export const quote = (s: string) => {
  const chars = [...s.replace(/\r?\n/g, ' ')];
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : chars.join('');
};
