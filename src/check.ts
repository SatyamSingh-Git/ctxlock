import { existsSync } from 'node:fs';
import { basename, posix, resolve } from 'node:path';
import { FAMILY_NAMES, type Finding, type HarnessId } from './model.js';
import { fsReader, type RepoReader } from './repo/reader.js';
import { type ScanResult, scanRepo } from './scan.js';
import { fetchUpstream } from './sync/fetch.js';

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
const DEFAULTS = { harnesses: ['claude-code', 'codex'] as HarnessId[], limits: {}, lint: { severity: {}, ignore: [] } };

// The folder `from` of the target, seen at `to` (an installed skill's place) and nothing else.
function mounted(base: RepoReader, files: string[], links: Map<string, string | null>, from: string, to: string): RepoReader {
  const inner = (path: string) => from + path.slice(to.length);
  const outer = (path: string) => to + path.slice(from.length);
  const listed = files.filter((p) => p.startsWith(from)).map(outer);
  return {
    root: base.root,
    ref: base.ref,
    listFiles: async () => listed,
    readFile: (path) => base.readFile(inner(path)),
    exists: async (path) => (path.startsWith(to) ? base.exists(inner(path)) : to.startsWith(`${path}/`)),
    listSymlinks: async () =>
      new Map([...links].filter(([link]) => link.startsWith(from)).map(([link, target]) => [outer(link), target?.startsWith(from) ? outer(target) : null])),
    readAll: (onFile, paths) => base.readAll((path, bytes) => onFile(outer(path), bytes), (paths ?? listed).map(inner)),
  };
}

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
  return { base: fsReader(folder), read: folder, name: basename(folder) };
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

  const scan = await scanRepo(base, { settings: DEFAULTS });
  collect(scan);
  // Skills are shared in folders no agent reads (skills/<name>/, or the folder itself), so each
  // SKILL.md that is not already a unit is read as if it were installed.
  const files = await base.listFiles();
  const links = await base.listSymlinks();
  const units = new Set(scan.units.flatMap((u) => u.files.map((f) => f.path)));
  for (const path of files.filter((p) => posix.basename(p) === 'SKILL.md' && !units.has(p))) {
    const from = path.slice(0, -'SKILL.md'.length);
    const to = `.agents/skills/${from ? posix.basename(from) : name}/`;
    collect(await scanRepo(mounted(base, files, links, from, to), { settings: DEFAULTS }), from, to);
  }
  return {
    target,
    read,
    runs,
    must: safety.filter((f) => f.severity === 'must'),
    worthALook: safety.filter((f) => f.severity === 'should'),
  };
}
