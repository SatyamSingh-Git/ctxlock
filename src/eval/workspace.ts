import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { stringify } from 'yaml';
import type { RepoReader } from '../repo/reader.js';
import { splitFrontmatter } from '../units/frontmatter.js';

export interface Materialized {
  files: number;
  stripped: string[];
  droppedLinks: string[];
}

// Config that makes Claude Code run commands of its own: project hooks, MCP servers, apiKeyHelper.
// Case-insensitive: on Windows and macOS, Claude Code opening .claude/settings.json finds .Claude/Settings.JSON.
const EXEC_FILES = /(^|\/)\.claude\/settings(\.local)?\.json$|^\.mcp\.json$/i;
const CLAUDE_MARKDOWN = /(^|\/)\.claude\/.*\.md$/i;
// Frontmatter keys that run something: a skill's own hooks, and the tools it may use without asking.
// << is a YAML merge key, which ctxlock's parser keeps as a key, but a parser that merges could
// bring either one in through it.
const RUN_KEYS = ['allowed-tools', 'hooks', '<<'];
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// Git paths use /, but on Windows a backslash in one is a separator too, so a tree entry such as
// a\..\..\x would land outside the copy. Such a file is not written.
function write(dir: string, path: string, bytes: Buffer): boolean {
  const full = resolve(dir, path);
  const rel = relative(dir, full);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  return true;
}

// A copy of the arm for an agent to work in. Links become plain files, so nothing in the copy can
// point outside it, and execution config is removed so that no hook or server from the repository
// runs during a probe.
export async function materialize(reader: RepoReader, dir: string): Promise<Materialized> {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const outside: string[] = [];
  const put = (path: string, bytes: Buffer) => void (write(dir, path, bytes) ? written : outside).push(path);
  await reader.readAll(put);

  const files = await reader.listFiles();
  const links = await reader.listSymlinks();
  const droppedLinks: string[] = [];
  for (const [link, target] of links) {
    // A link out of the repository, or to another link, is not followed (D25): neither is listed.
    if (target === null) {
      droppedLinks.push(link);
      continue;
    }
    const under = files.filter((f) => f.startsWith(`${target}/`));
    if (files.includes(target)) {
      put(link, await reader.readFile(target));
    } else if (under.length > 0) {
      for (const f of under) {
        const path = `${link}${f.slice(target.length)}`;
        put(path, await reader.readFile(f));
      }
    } else {
      droppedLinks.push(link);
    }
  }

  const stripped: string[] = [];
  let removed = 0;
  for (const path of written) {
    if (EXEC_FILES.test(path)) {
      rmSync(join(dir, path));
      stripped.push(path);
      removed++;
    } else if (CLAUDE_MARKDOWN.test(path)) {
      const text = readFileSync(join(dir, path), 'utf8');
      const { frontmatter, body, error } = splitFrontmatter(text);
      // Frontmatter ctxlock cannot parse might still parse for Claude Code, so naming such a key
      // anywhere in it, quoted or not, drops all of it.
      const raw = error === null ? '' : (FRONTMATTER.exec(text)?.[1] ?? '');
      const found = frontmatter ? RUN_KEYS.filter((k) => k in frontmatter) : RUN_KEYS.filter((k) => raw.includes(k));
      if (found.length > 0) {
        const rest = frontmatter && Object.fromEntries(Object.entries(frontmatter).filter(([k]) => !RUN_KEYS.includes(k)));
        writeFileSync(join(dir, path), rest ? `---\n${stringify(rest)}---\n${body}` : body);
        stripped.push(`${path} (${found.join(', ')})`);
      }
    }
  }

  execFileSync('git', ['init', '-q'], { cwd: dir });
  stripped.push(...outside.map((p) => `${p} (outside the copy)`));
  return { files: written.length - removed, stripped: stripped.sort(), droppedLinks: droppedLinks.sort() };
}

export type Snapshot = Map<string, string>;

export function snapshot(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const visit = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (path === '.git') continue;
      if (entry.isDirectory()) visit(path);
      else {
        const st = statSync(join(dir, path));
        out.set(path, `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  visit('');
  return out;
}

export function changedSince(dir: string, before: Snapshot): string[] {
  const after = snapshot(dir);
  const changed = new Set<string>();
  for (const [path, stamp] of after) if (before.get(path) !== stamp) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

function ancestors(dir: string): string[] {
  const out: string[] = [];
  let current = posix.dirname(dir.replaceAll('\\', '/'));
  for (;;) {
    out.push(current);
    const parent = posix.dirname(current);
    if (parent === current || parent === '.') return out;
    current = parent;
  }
}

const slashJoin = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`);

// What Claude Code would load from above the run folder that claudeMdExcludes cannot keep out:
// AGENTS.md comes through a plugin, and project skills are not memory files. The home folder's own
// .claude/skills is the user's, which --setting-sources project leaves out (spike S1).
export function ancestorContext(dir: string, home = homedir()): string[] {
  const homeDir = home.replaceAll('\\', '/');
  const found: string[] = [];
  for (const a of ancestors(dir)) {
    for (const name of ['AGENTS.md', '.claude/AGENTS.md']) if (existsSync(slashJoin(a, name))) found.push(slashJoin(a, name));
    if (a !== homeDir && existsSync(slashJoin(a, '.claude/skills'))) found.push(slashJoin(a, '.claude/skills'));
  }
  return found.sort();
}

const escapeGlob = (s: string) => s.replace(/[*?[\]{}()!+@]/g, '\\$&');

// claudeMdExcludes patterns: picomatch over absolute paths with backslashes turned into slashes.
export function ancestorExcludes(dir: string): string[] {
  return ancestors(dir).flatMap((a) =>
    ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', '.claude/rules/**'].map((name) => slashJoin(escapeGlob(a), name)),
  );
}
