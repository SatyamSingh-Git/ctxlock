import { posix } from 'node:path';
import MarkdownIt, { type Token } from 'markdown-it';
import type { Unit } from '../model.js';

const parser = new MarkdownIt({ html: true });
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

const hrefs = (tokens: Token[]): string[] =>
  tokens.flatMap((t) => [...(t.type === 'link_open' ? [String(t.attrGet('href') ?? '')] : []), ...hrefs(t.children ?? [])]);

// The repository paths a unit's Markdown links point to (D104). markdown-it resolves reference links,
// leaves code alone, and percent-encodes each href, so it is decoded back to a path.
export function linkedPaths(unit: Unit): string[] {
  const paths = new Set<string>();
  for (const href of hrefs(parser.parse(unit.body, {}))) {
    if (SCHEME.test(href) || href.startsWith('/')) continue;
    const target = href.replace(/[#?].*$/, '');
    if (target === '') continue;
    let path: string;
    try {
      path = decodeURIComponent(target);
    } catch {
      path = target;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(unit.path), path));
    if (resolved !== '..' && !resolved.startsWith('../')) paths.add(resolved);
  }
  return [...paths];
}
