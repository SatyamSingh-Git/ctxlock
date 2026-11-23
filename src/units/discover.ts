import { posix } from 'node:path';
import picomatch from 'picomatch';
import { parse } from 'yaml';
import { type Finding, MODELLED_FAMILIES, type Unit, type UnitFile, type UnitKind } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import { lfDigest, unitDigest } from './digest.js';
import { splitFrontmatter } from './frontmatter.js';

interface Pattern {
  match: (path: string) => boolean;
  kind: UnitKind;
  family: Unit['family'];
}

const glob = (...globs: string[]) => picomatch(globs, { dot: true });
// Windows and macOS read .Cursor/mcp.json as .cursor/mcp.json, so a pull request must not dodge the
// check by a folder's case. Root names such as GEMINI.md keep theirs: docs/agent.md is not an agent file.
const anyCase = (...globs: string[]) => picomatch(globs, { dot: true, nocase: true });

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
  // Other agents' files, for the safety checks only (the-guide/other-agents.md has each source).
  { match: anyCase('.github/copilot-instructions.md'), kind: 'instructions', family: 'copilot' },
  { match: anyCase('.github/instructions/**/*.instructions.md'), kind: 'rule', family: 'copilot' },
  { match: anyCase('**/.github/skills/*/SKILL.md'), kind: 'skill', family: 'copilot' },
  {
    match: anyCase('.github/workflows/copilot-setup-steps.yml', '.github/hooks/*.json', '**/.github/mcp.json', '.github/copilot/settings{,.local}.json', '.vscode/mcp.json'),
    kind: 'config',
    family: 'copilot',
  },
  { match: anyCase('**/.cursor/rules/**/*.mdc'), kind: 'rule', family: 'cursor' },
  { match: anyCase('.cursorrules'), kind: 'instructions', family: 'cursor' },
  { match: anyCase('**/.cursor/skills/*/SKILL.md'), kind: 'skill', family: 'cursor' },
  { match: anyCase('.cursor/mcp.json', '.cursor/hooks.json'), kind: 'config', family: 'cursor' },
  { match: glob('**/GEMINI.md'), kind: 'instructions', family: 'gemini' },
  { match: anyCase('**/.gemini/skills/*/SKILL.md'), kind: 'skill', family: 'gemini' },
  { match: anyCase('**/.gemini/settings.json'), kind: 'config', family: 'gemini' },
  { match: anyCase('**/{.agents,.agent,_agents,_agent}/rules/*.md'), kind: 'rule', family: 'antigravity' },
  {
    match: anyCase('**/{.agents,.agent,_agents,_agent}/{hooks.json,mcp_config.json}', '**/{.agents,.agent,_agents,_agent}/plugins/*/{plugin.json,hooks.json,mcp_config.json}', '**/{.agents,.agent,_agents,_agent}/plugins/*/{.antigravity-plugin,.gemini-plugin}/plugin.json'),
    kind: 'config',
    family: 'antigravity',
  },
  { match: anyCase('.devin/global_rules.md', '.windsurf/global_rules.md', '.windsurfrules'), kind: 'instructions', family: 'devin' },
  { match: anyCase('**/.devin/rules/*.md', '**/.windsurf/rules/*.md'), kind: 'rule', family: 'devin' },
  { match: anyCase('**/.devin/skills/*/SKILL.md', '**/.windsurf/skills/*/SKILL.md'), kind: 'skill', family: 'devin' },
  { match: anyCase('.devin/hooks.v1.json', '.devin/mcp_config.json', '**/.devin/config{,.local}.json'), kind: 'config', family: 'devin' },
  { match: anyCase('**/.kiro/steering/**/*.md'), kind: 'rule', family: 'kiro' },
  { match: anyCase('**/.kiro/skills/*/SKILL.md'), kind: 'skill', family: 'kiro' },
  { match: anyCase('.kiro/hooks/*.json', '.kiro/settings/mcp.json', '.kiro/agents/*.{json,md}'), kind: 'config', family: 'kiro' },
  { match: anyCase('.clinerules'), kind: 'instructions', family: 'cline' },
  { match: anyCase('.clinerules/skills/*/SKILL.md', '.cline/skills/*/SKILL.md'), kind: 'skill', family: 'cline' },
  // Cline runs each file in a hooks folder, named for its event, whatever its extension.
  { match: anyCase('.clinerules/hooks/*', '.cline/hooks/*', '.cline/plugins/**'), kind: 'config', family: 'cline' },
  // A skill's other files sit under .clinerules too, and are not rules.
  {
    match: picomatch(['.clinerules/**/*.{md,markdown,txt}', '.cline/rules/**/*.{md,markdown,txt}'], { dot: true, nocase: true, ignore: ['.clinerules/skills/**'] }),
    kind: 'rule',
    family: 'cline',
  },
  { match: anyCase('**/{.opencode,.kilo}/{skill,skills}/*/SKILL.md'), kind: 'skill', family: 'opencode' },
  { match: anyCase('{.kilocode,.kilo}/{rules,rules-*}/**/*.md', '**/.opencode/{agent,agents,command,commands,mode,modes}/**/*.md'), kind: 'rule', family: 'opencode' },
  { match: anyCase('.kilocoderules', '.kilocoderules-*'), kind: 'instructions', family: 'opencode' },
  {
    match: anyCase('**/{opencode,kilo}.{json,jsonc}', '{.kilo,.kilocode}/mcp.json', '**/.opencode/package.json', '**/{.opencode,.kilo,.kilocode}/{plugin,plugins,tool,tools}/**'),
    kind: 'config',
    family: 'opencode',
  },
  { match: anyCase('.junie/guidelines.md', '.junie/playbook.md'), kind: 'instructions', family: 'junie' },
  { match: anyCase('.junie/guidelines/**/*.md', '.junie/rules/**/*.md'), kind: 'rule', family: 'junie' },
  { match: anyCase('.junie/skills/*/SKILL.md'), kind: 'skill', family: 'junie' },
  { match: anyCase('.junie/mcp/mcp.json', '.junie/config.json'), kind: 'config', family: 'junie' },
  { match: glob('**/AGENT.md', '**/AGENTS.local.md'), kind: 'instructions', family: 'other' },
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
export function reachablePaths(paths: string[], links: Map<string, string | null>): Map<string, string> {
  const listed = new Set(paths);
  const reachable = new Map(paths.map((p) => [p, p]));
  for (const [link, target] of links) {
    if (target === null) continue;
    if (listed.has(target)) reachable.set(link, target);
    else for (const p of paths) if (p.startsWith(`${target}/`)) reachable.set(link + p.slice(target.length), p);
  }
  return reachable;
}

export async function discoverUnits(reader: RepoReader, declared: Declared = { knowledge: [], metrics: [] }): Promise<{ units: Unit[]; problems: Finding[]; bundles: string[] }> {
  const links = await reader.listSymlinks();
  const reachable = reachablePaths(await reader.listFiles(), links);
  const bundles = await okfBundles(reader, reachable);
  const units: Unit[] = [];
  const byPath = new Map<string, Unit>();
  const problems: Finding[] = [];

  const patternOf = (path: string) => PATTERNS.find((p) => p.match(path)) ?? businessPattern(path, declared, bundles);
  // A file an agent ctxlock models can reach is discovered exactly as it always was; another agent's
  // path to the same file adds nothing, so it cannot change a prediction. Its bytes are still checked.
  // Another agent's config is the exception: it stays a unit of its own, so the gate still fingerprints it.
  const modelledReal = new Set<string>();
  for (const [path, real] of reachable) {
    const pattern = patternOf(path);
    if (pattern && MODELLED_FAMILIES.has(pattern.family)) modelledReal.add(real);
  }

  // Listed files come first in `reachable`, so a link to an existing unit finds it and becomes its alias.
  for (const [path, real] of reachable) {
    const pattern = patternOf(path);
    if (!pattern || (!MODELLED_FAMILIES.has(pattern.family) && pattern.kind !== 'config' && modelledReal.has(real))) continue;

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
      // Other agents' rule parsers are not strict YAML (Cursor documents `globs: *.ts`), so a parse error
      // there says nothing about what the agent loads. Agent Skills are YAML for every agent.
      if (split.error && (MODELLED_FAMILIES.has(pattern.family) || pattern.kind === 'skill')) {
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
    // The agent follows a link at a config path wherever it leads, such as into node_modules, so a
    // target ctxlock cannot read would take that config out of the gate.
    if (patternOf(link)?.kind === 'config' && !reachable.has(link)) {
      problems.push({
        rule: 'L2-exec-config-unread',
        severity: 'must',
        message: `${link} is a symlink to ${target ?? 'a file outside the repository'}, which ctxlock cannot read, and the agent follows it`,
        path: link,
      });
    }
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
  return { units, problems, bundles };
}
