import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { FAMILY_NAMES, type Finding, type HarnessId } from './model.js';
import { fsReader, type RepoReader } from './repo/reader.js';
import { scanRepo } from './scan.js';
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

// A folder holding only SKILL.md and its files, as skills are shared, read as if it were installed.
function mounted(base: RepoReader, prefix: string): RepoReader {
  const inner = (path: string) => path.slice(prefix.length);
  const reader: RepoReader = {
    root: base.root,
    ref: base.ref,
    listFiles: async () => (await base.listFiles()).map((p) => prefix + p),
    readFile: (path) => base.readFile(inner(path)),
    exists: async (path) => (path.startsWith(prefix) ? base.exists(inner(path)) : prefix.startsWith(`${path}/`)),
    listSymlinks: async () => new Map([...(await base.listSymlinks())].map(([link, target]) => [prefix + link, target === null ? null : prefix + target])),
    readAll: (onFile, paths) => base.readAll((path, bytes) => onFile(prefix + path, bytes), paths?.map(inner)),
  };
  return reader;
}

// A URL by its scheme, or git's scp form (git@host:path). Anything else is a folder, so a mistyped
// path is an error, never a fetch.
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/|^[^/\\\s]+@[^/\\\s]+:/i;

async function readerOf(target: string, opts: { ref?: string; cache: string }): Promise<{ base: RepoReader; read: string; name: string }> {
  if (URL_LIKE.test(target)) {
    const ref = opts.ref ?? 'HEAD';
    const { commit, reader } = await fetchUpstream({ name: target, repo: target, ref, units: [], allowExec: [] }, opts.cache);
    return { base: reader, read: `${ref} @ ${commit.slice(0, 7)}`, name: basename(target.replace(/\.git\/?$/, '')) };
  }
  if (!existsSync(target)) throw new CheckError(`no such folder: ${target}`);
  const folder = resolve(target);
  return { base: fsReader(folder), read: target, name: basename(folder) };
}

export async function checkTarget(target: string, opts: { ref?: string; cache: string }): Promise<CheckResult> {
  const { base, read, name } = await readerOf(target, opts);
  let scan = await scanRepo(base, { settings: DEFAULTS });
  let prefix = '';
  if (scan.units.length === 0 && (await base.exists('SKILL.md'))) {
    prefix = `.agents/skills/${name}/`;
    scan = await scanRepo(mounted(base, prefix), { settings: DEFAULTS });
  }
  const own = (text: string) => (prefix ? text.replaceAll(prefix, '') : text);
  const unitOf = new Map(scan.units.map((u) => [u.id, u]));
  const runs = scan.inventory.map((f) => ({
    agent: prefix ? 'any agent that installs it' : FAMILY_NAMES[unitOf.get(f.unitId!)!.family],
    file: own(f.data!.file!),
    message: own(f.message),
  }));
  const safety = scan.findings
    .filter((f) => SAFETY.test(f.rule))
    .map(({ unitId, ...f }) => ({
      ...f,
      message: own(f.message),
      ...(f.path === undefined ? {} : { path: own(f.path) }),
      // A bare skill's unit is the folder itself, so its id would name a mount that is not there.
      ...(prefix || unitId === undefined ? {} : { unitId }),
    }));
  return {
    target,
    read,
    runs,
    must: safety.filter((f) => f.severity === 'must'),
    worthALook: safety.filter((f) => f.severity === 'should'),
  };
}
