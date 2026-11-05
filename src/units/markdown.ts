import MarkdownIt from 'markdown-it';

const SPAN = /(?<!`)(`+)(.*?[^`])\1(?!`)/g;

// html: true, because where an HTML block may start changes where paragraphs and fences end.
const parser = new MarkdownIt({ html: true });

// Lines inside fenced or indented code blocks, as CommonMark parses them: a fence inside a list item
// ends with the item, and ``` with a backtick in its info string is not a fence at all.
function codeBlockLines(markdown: string): Set<number> {
  const lines = new Set<number>();
  for (const token of parser.parse(markdown, {})) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) lines.add(i);
    }
  }
  return lines;
}

function mapLines(markdown: string, map: (line: string, inCode: boolean) => string): string {
  const code = codeBlockLines(markdown);
  return markdown
    .split('\n')
    .map((line, i) => map(line, code.has(i)))
    .join('\n');
}

// Code blocks and inline code spans become spaces of the same length, so offsets, lines and
// columns found in the result still point into the original text.
export function maskCode(markdown: string): string {
  return mapLines(markdown, (line, inCode) => (inCode ? ' '.repeat(line.length) : line.replace(SPAN, (span) => ' '.repeat(span.length))));
}

// The opposite of maskCode: everything outside code becomes spaces.
export function codeOnly(markdown: string): string {
  return mapLines(markdown, (line, inCode) => {
    if (inCode) return line;
    let kept = '';
    let last = 0;
    for (const m of line.matchAll(SPAN)) {
      kept += ' '.repeat(m.index - last) + m[0];
      last = m.index + m[0].length;
    }
    return kept + ' '.repeat(line.length - last);
  });
}

// Inline code spans outside code blocks, each with the offset of its content in the original text.
export function inlineCode(markdown: string): Array<{ code: string; offset: number }> {
  const spans: Array<{ code: string; offset: number }> = [];
  let offset = 0;
  mapLines(markdown, (line, inCode) => {
    if (!inCode) for (const m of line.matchAll(SPAN)) spans.push({ code: m[2]!, offset: offset + m.index + m[1]!.length });
    offset += line.length + 1;
    return line;
  });
  return spans;
}
