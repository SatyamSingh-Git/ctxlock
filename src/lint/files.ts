import type { Unit } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import type { LintContext } from './types.js';

// ignoreBOM keeps a leading BOM in the text, so L1 can allow it at offset 0 and flag it anywhere else.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Several rules read the same files, and a git-ref reader spawns git for each read, so each file is
// read once per reader.
const reads = new WeakMap<RepoReader, Map<string, Promise<Buffer>>>();

export function readOnce(reader: RepoReader, path: string): Promise<Buffer> {
  let files = reads.get(reader);
  if (!files) reads.set(reader, (files = new Map()));
  let buf = files.get(path);
  if (!buf) files.set(path, (buf = reader.readFile(path)));
  return buf;
}

// Each text file of each unit that `include` accepts, once. Files that are not UTF-8, such as
// images in a skill, are skipped.
export async function* textFiles(
  { reader, units }: LintContext,
  include: (unit: Unit) => boolean = () => true,
): AsyncGenerator<{ unit: Unit; path: string; text: string }> {
  const seen = new Set<string>();
  for (const unit of units) {
    if (!include(unit)) continue;
    for (const { path } of unit.files) {
      if (seen.has(path)) continue;
      seen.add(path);
      const buf = await readOnce(reader, path);
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
