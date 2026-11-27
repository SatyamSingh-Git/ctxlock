import { existsSync } from 'node:fs';
import { basename, posix, resolve } from 'node:path';
import { FAMILY_NAMES, type Finding, type HarnessId } from './model.js';
import { FileNotFound, fsReader, type RepoReader } from './repo/reader.js';
import { type ScanResult, scanRepo } from './scan.js';
import { fetchUpstream } from './sync/fetch.js';
import { reachablePaths } from './units/discover.js';
import { splitFrontmatter } from './units/frontmatter.js';

export class CheckError extends Error {}

export interface CheckItem {
  agent: string;
  file: string;
  message: string;
}

export interface CheckResult {
  target: string;
  read: string;
  runs: CheckItem[];
  must: Finding[];
  worthALook: Finding[];
}

// The safety rules: what reaches an agent unseen, and what runs. Inventory items are listed as runs.
const SAFETY = /^L[012]-/;
// The target is someone else's: its own ctxlock.yaml must not switch off or ignore what check reports.
const DEFAULTS = { harnesses: ['claude-code', 'codex'] as HarnessId[], limits: {}, lint: { severity: {}, ignore: [], exceptions: [] } };

// The folder `from` of the target, seen at `to` (an installed skill's place) and nothing else. A link
// in it reads as the file it reaches, wherever that is, as the agent would read it through the link.
function mounted(base: RepoReader, reachable: Map<string, string>, links: Map<string, string | null>, from: string, to: string): RepoReader {
  const source = new Map([...reachable].filter(([path]) => path.startsWith(from)).map(([path, real]) => [to + path.slice(from.length), real]));
  const listed = [...source.keys()];
  const real = (path: string) => {
    const found = source.get(path);
    if (found === undefined) throw new FileNotFound(path);
    return found;
  };
  return {
    root: base.root,
    ref: base.ref,
    listFiles: async () => listed,
    readFile: async (path) => base.readFile(real(path)),
    exists: async (path) => source.has(path) || listed.some((p) => p.startsWith(`${path}/`)),
    // Only links that lead outside the target are left as links, so a config one is still unread (D116).
    listSymlinks: async () => new Map([...links].filter(([link, target]) => target === null && link.startsWith(from)).map(([link]) => [to + link.slice(from.length), null])),
    readAll: async (onFile, paths) => {
      const askedAs = new Map<string, string[]>();
      for (const path of paths ?? listed) askedAs.set(real(path), [...(askedAs.get(real(path)) ?? []), path]);
      await base.readAll(async (path, bytes) => {
        for (const as of askedAs.get(path)!) await onFile(as, bytes);
      }, [...askedAs.keys()]);
    },
  };
}

// The Agent Skills spec's name: lowercase letters, digits and single hyphens, at most 64 characters.
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/;

// A URL by its scheme, or git's scp form (git@host:path). Anything else is a folder, so a mistyped
// path is an error, never a fetch.
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/|^[^/\\\s]+@[^/\\\s]+:/i;

async function readerOf(target: string, opts: { ref?: string; cache: string }): Promise<{ base: RepoReader; read: string; name: string }> {
  if (URL_LIKE.test(target)) {
    const ref = opts.ref ?? 'HEAD';
    const { commit, reader } = await fetchUpstream({ name: target, repo: target, ref, units: [], allowExec: [] }, opts.cache, { credentials: false });
    return { base: reader, read: `${ref} @ ${commit.slice(0, 7)}`, name: basename(target.replace(/\.git\/?$/, '')) };
  }
  if (!existsSync(target)) throw new CheckError(`no such folder: ${target}`);
  const folder = resolve(target);
  return { base: fsReader(folder, { git: false }), read: folder, name: basename(folder) };
}

export async function checkTarget(target: string, opts: { ref?: string; cache: string }): Promise<CheckResult> {
  const { base, read, name } = await readerOf(target, opts);
  const runs: CheckItem[] = [];
  const safety: Finding[] = [];
  // A skill inside another skill's folder is read twice, with that skill and on its own.
  const seen = new Set<string>();
  const once = <T>(list: T[], item: T) => {
    const key = JSON.stringify(item);
    if (!seen.has(key)) list.push(item);
    seen.add(key);
  };
  const collect = (scan: ScanResult, from = '', to = '') => {
    const own = (text: string) => (to ? text.replaceAll(to, from) : text);
    const unitOf = new Map(scan.units.map((u) => [u.id, u]));
    for (const f of scan.inventory)
      once(runs, { agent: to ? 'any agent that installs it' : FAMILY_NAMES[unitOf.get(f.unitId!)!.family], file: own(f.data!.file!), message: own(f.message) });
    for (const { unitId, ...f } of scan.findings.filter((f) => SAFETY.test(f.rule)))
      once(safety, {
        ...f,
        message: own(f.message),
        ...(f.path === undefined ? {} : { path: own(f.path) }),
        // A mounted skill's unit id names a place that is not in the target.
        ...(to || unitId === undefined ? {} : { unitId }),
      });
  };

  const scan = await scanRepo(base, { settings: DEFAULTS, suppressions: false });
  collect(scan);
  // Skills are shared in folders no agent reads (skills/<name>/, or the folder itself), so each
  // SKILL.md that is not an installed skill's own is read as if it were installed. Being part of some
  // other unit, such as knowledge the target declares, does not count: only a skill's hooks are inventoried.
  const links = await base.listSymlinks();
  const reachable = reachablePaths(await base.listFiles(), links);
  const installed = new Set(scan.units.filter((u) => u.kind === 'skill').flatMap((u) => [u.path, ...u.aliases].map((p) => `${p}/SKILL.md`)));
  for (const path of [...installed]) installed.add(reachable.get(path) ?? path);
  for (const [path, real] of reachable) {
    if (posix.basename(path) !== 'SKILL.md' || installed.has(path)) continue;
    const from = path.slice(0, -'SKILL.md'.length);
    // A skill shared as the target itself is installed under its own name; its folder's is whatever it was cloned as.
    const own = from ? undefined : splitFrontmatter((await base.readFile(real)).toString('utf8')).frontmatter?.name;
    const to = `.agents/skills/${from ? posix.basename(from) : typeof own === 'string' && SKILL_NAME.test(own) ? own : name}/`;
    collect(await scanRepo(mounted(base, reachable, links, from, to), { settings: DEFAULTS, suppressions: false }), from, to);
  }
  return {
    target,
    read,
    runs,
    must: safety.filter((f) => f.severity === 'must'),
    worthALook: safety.filter((f) => f.severity === 'should'),
  };
}
