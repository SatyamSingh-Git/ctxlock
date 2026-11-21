import { posix } from 'node:path';
import picomatch from 'picomatch';
import { parse } from 'yaml';
import type { Finding, Unit, UnitFile, UnitKind } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import { lfDigest, unitDigest } from './digest.js';
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
  { match: glob('**/.codex/config.toml', '**/.codex/hooks.json'), kind: 'config', family: 'codex' },
  { match: glob('.vscode/settings.json'), kind: 'config', family: 'vscode' },
];

const utf8 = new TextDecoder('utf-8', { fatal: true });

// Business context (D102): folders and files ctxlock.yaml or the lock names, and the formats' own marks.
export interface Declared {
  knowledge: string[];
  metrics: string[];
}
const NOT_CONCEPTS = new Set(['index.md', 'log.md']);
const OSSIE_FILE = glob('**/*.ossie.yaml', '**/*.ossie.yml', '**/*.ossie.json');
const MODEL_FILE = /\.(ya?ml|json)$/;
const under = (path: string, folder: string) => folder === '.' || path === folder || path.startsWith(`${folder}/`);

// An OKF bundle may declare itself with okf_version in its root index.md, the only frontmatter an index may carry.
// A docs site has an index.md per page, so they are read in one batch: one git process, not one each.
async function okfBundles(reader: RepoReader, reachable: Map<string, string>): Promise<string[]> {
  const reachedAs = new Map<string, string[]>();
  for (const [path, real] of reachable) if (posix.basename(path) === 'index.md') reachedAs.set(real, [...(reachedAs.get(real) ?? []), path]);
  if (reachedAs.size === 0) return [];
  const bundles: string[] = [];
  await reader.readAll((real, bytes) => {
    const { frontmatter } = splitFrontmatter(bytes.toString('utf8'));
    if (frontmatter && 'okf_version' in frontmatter) bundles.push(...reachedAs.get(real)!.map((path) => posix.dirname(path)));
  }, [...reachedAs.keys()]);
  return bundles;
}

function businessPattern(path: string, declared: Declared, bundles: string[]): Pattern | undefined {
  if (path.endsWith('.md') && !NOT_CONCEPTS.has(posix.basename(path)) && [...declared.knowledge, ...bundles].some((f) => under(path, f))) {
    return { match: () => true, kind: 'knowledge', family: 'okf' };
  }
  if (OSSIE_FILE(path) || declared.metrics.some((m) => under(path, m) && MODEL_FILE.test(path))) {
    return { match: () => true, kind: 'metric', family: 'ossie' };
  }
  return undefined;
}

function modelName(text: string): string | undefined {
  try {
    // YAML 1.2 reads JSON too.
    const model: unknown = parse(text, { schema: 'core' });
    const name = (model as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    // L17-format reports a model that does not parse.
    return undefined;
  }
}


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

export async function discoverUnits(reader: RepoReader, declared: Declared = { knowledge: [], metrics: [] }): Promise<{ units: Unit[]; problems: Finding[] }> {
  const links = await reader.listSymlinks();
  const reachable = reachablePaths(await reader.listFiles(), links);
  const bundles = await okfBundles(reader, reachable);
  const units: Unit[] = [];
  const byPath = new Map<string, Unit>();
  const problems: Finding[] = [];

  // Listed files come first in `reachable`, so a link to an existing unit finds it and becomes its alias.
  for (const [path, real] of reachable) {
    const pattern = PATTERNS.find((p) => p.match(path)) ?? businessPattern(path, declared, bundles);
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
    if (pattern.kind === 'rule' || pattern.kind === 'skill' || pattern.kind === 'knowledge') {
      const split = splitFrontmatter(text);
      frontmatter = split.frontmatter;
      body = split.body;
      if (split.error) {
        problems.push({
          rule: 'L0-frontmatter',
          severity: pattern.kind === 'rule' ? 'should' : 'must',
          message: `invalid frontmatter in ${path}: ${split.error}`,
          path,
          unitId: id,
        });
      }
    }

    let name = unitPath;
    if (pattern.kind === 'rule') name = posix.basename(path, '.md');
    if (pattern.kind === 'skill') name = typeof frontmatter?.name === 'string' ? frontmatter.name : posix.basename(unitPath);
    if (pattern.kind === 'knowledge') name = typeof frontmatter?.title === 'string' ? frontmatter.title : posix.basename(path, '.md');
    if (pattern.kind === 'metric') name = modelName(text) ?? posix.basename(path);

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
