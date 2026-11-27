import type { Unit } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import { maskCode } from '../units/markdown.js';
import type { LintContext } from './types.js';

// ignoreBOM keeps a leading BOM in the text, so L1 can allow it at offset 0 and flag it anywhere else.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenient = new TextDecoder('utf-8', { ignoreBOM: true });

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
// images in a skill, are skipped. With `anyText`, a file with no NUL byte, which git would call text,
// is read with each invalid byte replaced, so one Latin-1 byte cannot hide the rest of the file.
export async function* textFiles(
  { reader, units }: LintContext,
  include: (unit: Unit) => boolean = () => true,
  anyText = false,
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
        if (!anyText || buf.includes(0)) continue;
        text = lenient.decode(buf);
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

// Every HTML comment outside code, as GitHub renders the markdown. An unclosed comment hides everything
// after it, so it runs to the end of the file.
export function htmlComments(text: string): Array<{ comment: string; line: number; column: number }> {
  return [...maskCode(text).matchAll(/<!--[\s\S]*?(?:-->|$)/g)].map((match) => ({
    comment: text.slice(match.index, match.index + match[0].length),
    ...lineAndColumn(text, match.index),
  }));
}

export const quote = (s: string) => {
  const chars = [...s.replace(/\r?\n/g, ' ')];
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : chars.join('');
};
