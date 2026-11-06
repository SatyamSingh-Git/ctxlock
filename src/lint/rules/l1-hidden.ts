import type { Finding, Severity } from '../../model.js';
import { sha256Hex } from '../../units/digest.js';
import { maskCode } from '../../units/markdown.js';
import { lineAndColumn, quote, textFiles } from '../files.js';
import type { Rule } from '../types.js';

// Invisible characters that can carry or reorder text an agent reads but a reviewer cannot see.
const MUST: Array<[number, number]> = [
  [0x200b, 0x200d],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

const NAMES: Record<number, string> = {
  0x00ad: 'SOFT HYPHEN',
  0x061c: 'ARABIC LETTER MARK',
  0x180e: 'MONGOLIAN VOWEL SEPARATOR',
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x2060: 'WORD JOINER',
  0x2061: 'FUNCTION APPLICATION',
  0x2062: 'INVISIBLE TIMES',
  0x2063: 'INVISIBLE SEPARATOR',
  0x2064: 'INVISIBLE PLUS',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0xe0001: 'LANGUAGE TAG',
  0xe007f: 'CANCEL TAG',
};

function describe(cp: number): string {
  let name = NAMES[cp];
  if (cp >= 0xfe00 && cp <= 0xfe0f) name = `VARIATION SELECTOR-${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) name = `VARIATION SELECTOR-${cp - 0xe0100 + 17}`;
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}${name ? ` ${name}` : ''}`;
}

const has = (re: RegExp) => (cp: number | undefined) => cp !== undefined && re.test(String.fromCodePoint(cp));
const pictographic = has(/\p{Extended_Pictographic}/u);
const skinTone = has(/\p{Emoji_Modifier}/u);
const format = has(/\p{Cf}/u);
// Scripts whose spelling uses ZWNJ and ZWJ inside words, such as Persian and Hindi.
const joiningScript = has(
  /[\p{scx=Arabic}\p{scx=Syriac}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}]/u,
);
const keycapBase = (cp: number | undefined) => cp !== undefined && ((cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a);
const isTag = (cp: number | undefined) => cp !== undefined && cp >= 0xe0020 && cp <= 0xe007f;
// Subdivision flags are U+1F3F4, a tag-letter code, then CANCEL TAG. Only England, Scotland and Wales
// are recommended for general display (RGI); any other code could carry hidden text, a few letters
// per flag, so only those three are allowed.
const RGI_FLAGS = ['gbeng', 'gbsct', 'gbwls'].map((code) => [...code].map((c) => 0xe0000 + c.charCodeAt(0)));

function flagTagIndexes(cps: number[]): Set<number> {
  const allowed = new Set<number>();
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] !== 0x1f3f4) continue;
    const code = RGI_FLAGS.find((tags) => tags.every((tag, j) => cps[i + 1 + j] === tag) && cps[i + 1 + tags.length] === 0xe007f);
    if (code) for (let j = i + 1; j <= i + 1 + code.length; j++) allowed.add(j);
  }
  return allowed;
}

function severityAt(cps: number[], i: number, flagTags: Set<number>): Severity | null {
  const cp = cps[i]!;
  if (cp < 0xad) return null;
  const prev = cps[i - 1];
  const next = cps[i + 1];
  if (MUST.some(([from, to]) => cp >= from && cp <= to)) {
    if (cp === 0xfeff && i === 0) return null;
    if (cp === 0x200d && pictographic(next) && (pictographic(prev) || skinTone(prev) || prev === 0xfe0f)) return null;
    if ((cp === 0x200c || cp === 0x200d) && joiningScript(prev) && joiningScript(next)) return null;
    if ((cp === 0xfe0e || cp === 0xfe0f) && (pictographic(prev) || (keycapBase(prev) && next === 0x20e3))) return null;
    if (isTag(cp) && flagTags.has(i)) return null;
    return 'must';
  }
  return format(cp) ? 'should' : null;
}

export const hiddenUnicode: Rule = {
  id: 'L1-hidden-unicode',
  async check(ctx) {
    const findings: Finding[] = [];
    for await (const { unit, path, text } of textFiles(ctx)) {
      const cps = Array.from(text, (c) => c.codePointAt(0)!);
      const flagTags = flagTagIndexes(cps);
      let line = 1;
      let column = 1;
      for (let i = 0; i < cps.length; i++) {
        const severity = severityAt(cps, i, flagTags);
        if (severity) {
          // A run of hidden characters is one finding; a Tag-block run is decoded to the text it hides.
          let end = i + 1;
          while (end < cps.length && severityAt(cps, end, flagTags) === severity) end++;
          const run = cps.slice(i, end);
          const spelled = run.filter((c) => c >= 0xe0020 && c <= 0xe007e).map((c) => String.fromCharCode(c - 0xe0000)).join('');
          const where = `${describe(run[0]!)} at ${line}:${column}`;
          const message =
            (run.length === 1 ? `hidden character ${where}` : `${run.length} hidden characters starting with ${where}`) +
            (spelled ? `, spelling "${quote(spelled)}"` : '');
          const fingerprint = `sha256:${sha256Hex(run.map((c) => String.fromCodePoint(c)).join(''))}`;
          findings.push({ rule: 'L1-hidden-unicode', severity, message, path, line, column, unitId: unit.id, data: { fingerprint } });
          column += end - i;
          i = end - 1;
          continue;
        }
        if (cps[i] === 0x0a) {
          line++;
          column = 1;
        } else {
          column++;
        }
      }
    }
    return findings;
  },
};

// One-line generated-block markers and lint directives, which carry no instructions: BEGIN:/END: pairs
// such as Next.js's nextjs-agent-rules block, markdownlint and prettier directives, and TOC markers.
// The grammar is tight on purpose, so no sentence fits inside one.
const MARKER =
  /^<!--\s*(?:(?:BEGIN|END)[: ][a-z0-9]+(?:[-_.][a-z0-9]+){0,4}|markdownlint-(?:disable|enable|capture|restore|disable-line|disable-next-line|disable-file|enable-file)(?: +MD\d{3})*|prettier-ignore(?:-start|-end)?|toc|tocstop)\s*-->$/i;

export const htmlComment: Rule = {
  id: 'L1-html-comment',
  async check(ctx) {
    const findings: Finding[] = [];
    for await (const { unit, path, text } of textFiles(ctx)) {
      if (!path.endsWith('.md')) continue;
      // An unclosed comment hides everything after it, so it runs to the end of the file.
      for (const match of maskCode(text).matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        const { line, column } = lineAndColumn(text, match.index);
        const comment = text.slice(match.index, match.index + match[0].length);
        findings.push({
          rule: 'L1-html-comment',
          severity: MARKER.test(comment) ? 'info' : 'must',
          message: `HTML comment at ${line}:${column} is hidden when the markdown is rendered: "${quote(comment)}"`,
          path,
          line,
          column,
          unitId: unit.id,
          data: { fingerprint: `sha256:${sha256Hex(comment)}` },
        });
      }
    }
    return findings;
  },
};
