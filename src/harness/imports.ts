// Claude Code's `@path` imports. Code spans and fenced blocks are skipped, as Claude Code does;
// an `@` glued to a word (user@example.com) is not an import.
export function findImports(markdown: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@([^\s`'"<>()[\]]+)/g)) {
      found.push(match[1]!.replace(/[.,;:!?]+$/, ''));
    }
  }
  return found;
}
