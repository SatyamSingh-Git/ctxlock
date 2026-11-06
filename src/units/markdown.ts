import MarkdownIt from 'markdown-it';

// A code span as markdown-it found it: offsets into the content of the inline token it is in.
interface Span {
  start: number;
  end: number;
  marker: number;
}

// html: true, because where an HTML block may start changes where paragraphs and fences end.
// Inline content is parsed below, one block at a time, so the core pass leaves it alone.
const parser = new MarkdownIt({ html: true });
parser.core.ruler.disable('inline');

// Code spans are taken from markdown-it's own backticks rule, so escapes, HTML tags and spans that
// cross lines are read the way GitHub renders them: `\`<!-- x -->\`` is a hidden comment, not code.
const backticks = parser.inline.ruler.__rules__.find((r) => r.name === 'backticks')!.fn;
parser.inline.ruler.at('backticks', (state, silent) => {
  const start = state.pos;
  const count = state.tokens.length;
  const found = backticks(state, silent);
  const token = state.tokens.at(-1);
  if (found && state.tokens.length > count && token?.type === 'code_inline') {
    (state.env as { spans: Span[] }).spans.push({ start, end: state.pos, marker: token.markup.length });
  }
  return found;
});

interface Analysis {
  // Lines inside fenced or indented code blocks.
  codeLines: Set<number>;
  // Inline code spans in the original text, cut at line ends: [from, to) for the whole span, with
  // the content's offset and text.
  spans: Array<{ ranges: Array<[number, number]>; offset: number; code: string }>;
}

// Most rules read the same files, so one lint run parses each text once.
const analyzed = new Map<string, Analysis>();

function analyze(markdown: string): Analysis {
  let found = analyzed.get(markdown);
  if (!found) {
    if (analyzed.size >= 256) analyzed.clear();
    analyzed.set(markdown, (found = parse(markdown)));
  }
  return found;
}

function parse(markdown: string): Analysis {
  const lines = markdown.split('\n');
  const lineStarts: number[] = [];
  let at = 0;
  for (const line of lines) {
    lineStarts.push(at);
    at += line.length + 1;
  }

  const codeLines = new Set<number>();
  const spans: Analysis['spans'] = [];
  const cursor = new Map<number, number>();
  // Table cells have no map of their own; their row has.
  let row: [number, number] | null = null;
  for (const token of parser.parse(markdown, {})) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) codeLines.add(i);
    }
    if (token.type === 'tr_open') row = token.map;
    const map = token.map ?? row;
    if (token.type !== 'inline' || !map) continue;

    // Each line of the token's content is the tail of a source line, after indentation, list
    // markers or `>`; find where, left to right, so table cells on one line keep their order.
    const content = token.content.split('\n');
    const base = content.map((text, k) => {
      const line = map[0] + k;
      const column = lines[line]?.indexOf(text, cursor.get(line) ?? 0) ?? -1;
      if (column < 0) return null;
      cursor.set(line, column + text.length);
      return lineStarts[line]! + column;
    });
    const contentStarts: number[] = [];
    let offset = 0;
    for (const text of content) {
      contentStarts.push(offset);
      offset += text.length + 1;
    }
    const toSource = (index: number): [number, number] | null => {
      let k = contentStarts.length - 1;
      while (contentStarts[k]! > index) k--;
      const start = base[k];
      return start === null || start === undefined ? null : [k, start + index - contentStarts[k]!];
    };

    const env = { spans: [] as Span[] };
    parser.inline.parse(token.content, parser, env, []);
    for (const span of env.spans) {
      const from = toSource(span.start);
      const to = toSource(span.end - 1);
      if (!from || !to) continue;
      const ranges: Array<[number, number]> = [];
      for (let k = from[0]; k <= to[0]; k++) {
        const lineFrom = k === from[0] ? from[1] : base[k];
        const lineTo = k === to[0] ? to[1] + 1 : (base[k] ?? 0) + content[k]!.length;
        if (lineFrom === null || lineFrom === undefined) continue;
        ranges.push([lineFrom, lineTo]);
      }
      spans.push({ ranges, offset: from[1] + span.marker, code: token.content.slice(span.start + span.marker, span.end - span.marker) });
    }
  }
  return { codeLines, spans };
}

function blank(markdown: string, keep: (inCode: boolean) => boolean): string {
  const { codeLines, spans } = analyze(markdown);
  const inSpan = new Uint8Array(markdown.length);
  for (const { ranges } of spans) for (const [from, to] of ranges) inSpan.fill(1, from, to);
  let line = 0;
  let out = '';
  for (let i = 0; i < markdown.length; i++) {
    const c = markdown[i]!;
    if (c === '\n') {
      line++;
      out += c;
    } else {
      out += keep(codeLines.has(line) || inSpan[i] === 1) ? c : ' ';
    }
  }
  return out;
}

// Code blocks and inline code spans become spaces of the same length, so offsets, lines and
// columns found in the result still point into the original text.
export function maskCode(markdown: string): string {
  return blank(markdown, (inCode) => !inCode);
}

// The opposite of maskCode: everything outside code becomes spaces.
export function codeOnly(markdown: string): string {
  return blank(markdown, (inCode) => inCode);
}

// Inline code spans outside code blocks, each with the offset of its content in the original text.
export function inlineCode(markdown: string): Array<{ code: string; offset: number }> {
  return analyze(markdown).spans.map(({ code, offset }) => ({ code, offset }));
}
