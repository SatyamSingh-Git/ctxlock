import { posix } from 'node:path';
import picomatch from 'picomatch';
import type { Finding, Unit, UnitFile, UnitKind } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import { sha256Hex, unitDigest } from './digest.js';
import { splitFrontmatter } from './frontmatter.js';

interface Pattern {
  match: (path: string) => boolean;
  kind: UnitKind;
  family: Unit['family'];
}

const glob = (...globs: string[]) => picomatch(globs, { dot: true });

// Order matters: the first matching row decides the kind.
const PATTERNS: Pattern[] = [
  { match: glob('**/AGENTS.md', '**/AGENTS.override.md'), kind: 'instructions', family: 'agents-md' },
  { match: glob('**/CLAUDE.md', '**/.claude/CLAUDE.md', '**/CLAUDE.local.md'), kind: 'instructions', family: 'claude' },
  { match: glob('**/.claude/rules/**/*.md'), kind: 'rule', family: 'claude' },
  { match: glob('**/.claude/skills/*/SKILL.md'), kind: 'skill', family: 'claude' },
  { match: glob('**/.agents/skills/*/SKILL.md'), kind: 'skill', family: 'agents' },
  { match: glob('.claude/settings.json', '.claude/settings.local.json', '.mcp.json'), kind: 'config', family: 'claude' },
  { match: glob('.codex/config.toml', '.codex/hooks.json'), kind: 'config', family: 'codex' },
  { match: glob('.vscode/settings.json'), kind: 'config', family: 'vscode' },
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

// Hashed with CRLF read as LF, so a core.autocrlf checkout and its git ref agree on a unit's identity.
// bytes stays raw, because that is what an agent reads from disk.
const lfDigest = (buf: Buffer) => sha256Hex(buf.includes(0x0d) ? Buffer.from(buf.toString('latin1').replaceAll('\r\n', '\n'), 'latin1') : buf);

// Every path an agent can open, mapped to the listed file behind it. A link to a file adds the
// link's own path; a link to a directory adds the link path of every listed file under it.
// Links to links are not followed.
function reachablePaths(paths: string[], links: Map<string, string | null>): Map<string, string> {
  const listed = new Set(paths);
  const reachable = new Map(paths.map((p) => [p, p]));
  for (const [link, target] of links) {
    if (target === null) continue;
    if (listed.has(target)) reachable.set(link, target);
    else for (const p of paths) if (p.startsWith(`${target}/`)) reachable.set(link + p.slice(target.length), p);
  }
  return reachable;
}

export async function discoverUnits(reader: RepoReader): Promise<{ units: Unit[]; problems: Finding[] }> {
  const links = await reader.listSymlinks();
  const reachable = reachablePaths(await reader.listFiles(), links);
  const units: Unit[] = [];
  const byPath = new Map<string, Unit>();
  const problems: Finding[] = [];

  // Listed files come first in `reachable`, so a link to an existing unit finds it and becomes its alias.
  for (const [path, real] of reachable) {
    const pattern = PATTERNS.find((p) => p.match(path));
    if (!pattern) continue;

    const unitPath = pattern.kind === 'skill' ? posix.dirname(path) : path;
    if (path !== real) {
      const target = byPath.get(pattern.kind === 'skill' ? posix.dirname(real) : real);
      if (target?.kind === pattern.kind) {
        target.aliases.push(unitPath);
        continue;
      }
    }

    const id = `${pattern.kind}/${unitPath}`;
    const members: Array<[string, string]> =
      pattern.kind === 'skill' ? [...reachable].filter(([p]) => p.startsWith(`${unitPath}/`)) : [[path, real]];

    const files: UnitFile[] = [];
    let main: Buffer | undefined;
    for (const [member, source] of members) {
      const buf = await reader.readFile(source);
      if (member === path) main = buf;
      files.push({ path: source, bytes: buf.length, sha256: lfDigest(buf) });
    }

    let text = '';
    try {
      text = utf8.decode(main);
    } catch {
      problems.push({ rule: 'L0-encoding', severity: 'should', message: `${path} is not valid UTF-8`, path, unitId: id });
    }

    let frontmatter: Record<string, unknown> | null = null;
    let body = text.replace(/\r\n/g, '\n');
    if (pattern.kind === 'rule' || pattern.kind === 'skill') {
      const split = splitFrontmatter(text);
      frontmatter = split.frontmatter;
      body = split.body;
      if (split.error) {
        problems.push({
          rule: 'L0-frontmatter',
          severity: pattern.kind === 'skill' ? 'must' : 'should',
          message: `invalid frontmatter in ${path}: ${split.error}`,
          path,
          unitId: id,
        });
      }
    }

    let name = unitPath;
    if (pattern.kind === 'rule') name = posix.basename(path, '.md');
    if (pattern.kind === 'skill') name = typeof frontmatter?.name === 'string' ? frontmatter.name : posix.basename(unitPath);

    const unit: Unit = {
      id,
      kind: pattern.kind,
      family: pattern.family,
      path: unitPath,
      aliases: [],
      name,
      files,
      digest: unitDigest(files),
      text,
      frontmatter,
      body,
    };
    units.push(unit);
    byPath.set(unitPath, unit);
  }

  for (const [link, target] of links) {
    if (target === null) {
      problems.push({
        rule: 'L0-symlink-outside',
        severity: 'info',
        message: `symlink ${link} points outside the repository and was not followed`,
        path: link,
      });
      continue;
    }
    // A link that is not itself a context path, such as docs/guide.md -> AGENTS.md, still names the unit for imports.
    const unit = byPath.get(target);
    if (unit && !byPath.has(link) && !unit.aliases.includes(link)) unit.aliases.push(link);
  }

  units.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { units, problems };
}
