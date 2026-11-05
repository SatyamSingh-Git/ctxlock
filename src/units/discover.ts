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
  { match: glob('.claude/rules/**/*.md'), kind: 'rule', family: 'claude' },
  { match: glob('**/.claude/skills/*/SKILL.md'), kind: 'skill', family: 'claude' },
  { match: glob('**/.agents/skills/*/SKILL.md'), kind: 'skill', family: 'agents' },
  { match: glob('.claude/settings.json', '.claude/settings.local.json', '.mcp.json'), kind: 'config', family: 'claude' },
  { match: glob('.codex/config.toml', '.codex/hooks.json'), kind: 'config', family: 'codex' },
  { match: glob('.vscode/settings.json'), kind: 'config', family: 'vscode' },
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

export async function discoverUnits(reader: RepoReader): Promise<{ units: Unit[]; problems: Finding[] }> {
  const paths = await reader.listFiles();
  const units: Unit[] = [];
  const problems: Finding[] = [];

  for (const path of paths) {
    const pattern = PATTERNS.find((p) => p.match(path));
    if (!pattern) continue;

    const unitPath = pattern.kind === 'skill' ? posix.dirname(path) : path;
    const id = `${pattern.kind}/${unitPath}`;
    const memberPaths = pattern.kind === 'skill' ? paths.filter((p) => p.startsWith(`${unitPath}/`)) : [path];

    const files: UnitFile[] = [];
    let main: Buffer | undefined;
    for (const member of memberPaths) {
      const buf = await reader.readFile(member);
      if (member === path) main = buf;
      files.push({ path: member, bytes: buf.length, sha256: sha256Hex(buf) });
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

    units.push({
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
    });
  }

  const byPath = new Map(units.map((u) => [u.path, u]));
  for (const [link, target] of await reader.listSymlinks()) {
    if (target === null) {
      problems.push({
        rule: 'L0-symlink-outside',
        severity: 'info',
        message: `symlink ${link} points outside the repository and was not followed`,
        path: link,
      });
      continue;
    }
    byPath.get(target)?.aliases.push(link);
  }

  units.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { units, problems };
}
