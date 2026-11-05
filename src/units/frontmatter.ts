import { parse } from 'yaml';

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^---[ \t]*(?:\r?\n|$)/m;

export function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
  error: string | null;
} {
  const src = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n');
  const open = OPEN.exec(src);
  if (!open) return { frontmatter: null, body: src, error: null };

  const rest = src.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (!close) return { frontmatter: null, body: src, error: 'frontmatter has no closing ---' };

  const body = rest.slice(close.index + close[0].length);
  let parsed: unknown;
  try {
    // The core schema keeps 2026-10-01 a string instead of turning it into a Date.
    parsed = parse(rest.slice(0, close.index), { schema: 'core' });
  } catch (err) {
    return { frontmatter: null, body, error: (err as Error).message };
  }
  if (parsed === null || parsed === undefined) return { frontmatter: {}, body, error: null };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { frontmatter: null, body, error: 'frontmatter is not a mapping' };
  }
  return { frontmatter: parsed as Record<string, unknown>, body, error: null };
}
