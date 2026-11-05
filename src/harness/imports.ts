import { maskCode } from '../units/markdown.js';

// Claude Code's `@path` imports. Code spans and fenced blocks are skipped, as Claude Code does;
// an `@` glued to a word (user@example.com) is not an import.
export function findImports(markdown: string): string[] {
  const found: string[] = [];
  for (const match of maskCode(markdown).matchAll(/(?:^|\s)@([^\s`'"<>()[\]]+)/gm)) {
    found.push(match[1]!.replace(/[.,;:!?]+$/, ''));
  }
  return found;
}
