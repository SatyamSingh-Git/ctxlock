import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The file-writing tooling rewrites unicode escapes for invisible characters into the raw
// characters, so the pattern is built from numeric code points and fixtures must do the same.
const cp = (n: number) => String.fromCodePoint(n);
const range = (from: number, to: number) => `${cp(from)}-${cp(to)}`;
const HIDDEN = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2060, 0x2064)}${range(0x2066, 0x2069)}${cp(0xfeff)}${range(0xe0000, 0xe007f)}]`,
  'u',
);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('source hygiene', () => {
  it('no source or test file contains a raw hidden character', () => {
    const offenders = ['src', 'tests'].flatMap(files).filter((f) => HIDDEN.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
