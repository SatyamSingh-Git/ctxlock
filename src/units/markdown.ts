const SPAN = /(?<!`)(`+)(.*?[^`])\1(?!`)/g;

function mapLines(markdown: string, map: (line: string, fenced: boolean) => string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence !== null) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
        return map(line, true);
      }
      if (marker !== undefined) {
        fence = marker;
        return map(line, true);
      }
      return map(line, false);
    })
    .join('\n');
}

// Fenced code blocks and inline code spans become spaces of the same length, so offsets, lines
// and columns found in the result still point into the original text.
export function maskCode(markdown: string): string {
  return mapLines(markdown, (line, fenced) => (fenced ? ' '.repeat(line.length) : line.replace(SPAN, (span) => ' '.repeat(span.length))));
}

// Inline code spans outside fenced blocks, each with the offset of its content in the original text.
export function inlineCode(markdown: string): Array<{ code: string; offset: number }> {
  const spans: Array<{ code: string; offset: number }> = [];
  let offset = 0;
  mapLines(markdown, (line, fenced) => {
    if (!fenced) for (const m of line.matchAll(SPAN)) spans.push({ code: m[2]!, offset: offset + m.index + m[1]!.length });
    offset += line.length + 1;
    return line;
  });
  return spans;
}
