import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, readlink, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

export interface RepoReader {
  readonly root: string;
  readonly ref: string | null;
  listFiles(): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  listSymlinks(): Promise<Map<string, string | null>>;
}

export class FileNotFound extends Error {
  constructor(readonly path: string) {
    super(`file not found: ${path}`);
  }
}

export class RefNotFound extends Error {
  constructor(readonly ref: string) {
    super(`ref not found: ${ref}`);
  }
}

interface Listing {
  files: string[];
  links: Map<string, string | null>;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, ...args], { maxBuffer: MAX_BUFFER });
  return stdout;
}

async function gitBuffer(root: string, args: string[]): Promise<Buffer> {
  const { stdout } = await exec('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: MAX_BUFFER });
  return stdout;
}

// execFile reports a non-zero exit as a numeric code; a string code means git itself could not start.
function exitedNonZero(err: unknown): boolean {
  return typeof (err as { code?: unknown }).code === 'number';
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

const nulSplit = (s: string) => s.split('\0').filter(Boolean);
const toPosix = (p: string) => p.split(sep).join('/');
const skipped = (path: string) => path.split('/').some((s) => s === '.git' || s === 'node_modules');

function insideRepo(path: string): string | null {
  const normalized = posix.normalize(path);
  if (normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) return null;
  return normalized;
}

function resolveGitTarget(linkPath: string, target: string): string | null {
  if (posix.isAbsolute(target) || /^[A-Za-z]:/.test(target)) return null;
  return insideRepo(posix.join(posix.dirname(linkPath), target));
}

function resolveFsTarget(root: string, linkPath: string, target: string): string | null {
  const absolute = resolve(dirname(join(root, linkPath)), target);
  const rel = relative(root, absolute);
  if (isAbsolute(rel)) return null;
  return insideRepo(toPosix(rel));
}

async function isGitWorkTree(root: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch (err) {
    if (exitedNonZero(err)) return false;
    throw err;
  }
}

async function listGitWorkTree(root: string): Promise<Listing> {
  const [staged, untracked, deletedOut, localOut] = await Promise.all([
    git(root, ['ls-files', '-z', '-s']),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard']),
    git(root, ['ls-files', '-z', '--deleted']),
    // CLAUDE.local.md is usually gitignored, yet Claude Code still loads it on this machine.
    git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ':(glob)**/CLAUDE.local.md']),
  ]);
  const deleted = new Set(nulSplit(deletedOut));
  const files = new Set<string>();
  const links = new Map<string, string | null>();

  for (const entry of nulSplit(staged)) {
    const tab = entry.indexOf('\t');
    const [mode, object] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (deleted.has(path) || skipped(path) || mode === '160000') continue;
    if (mode === '120000') links.set(path, resolveGitTarget(path, await git(root, ['cat-file', 'blob', object!])));
    else files.add(path);
  }

  for (const path of nulSplit(untracked)) {
    if (skipped(path)) continue;
    if ((await lstat(join(root, path))).isSymbolicLink()) {
      links.set(path, resolveFsTarget(root, path, await readlink(join(root, path))));
    } else {
      files.add(path);
    }
  }
  for (const path of nulSplit(localOut)) if (!skipped(path)) files.add(path);

  return { files: [...files].sort(), links };
}

async function walk(root: string): Promise<Listing> {
  const files: string[] = [];
  const links = new Map<string, string | null>();
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.set(path, resolveFsTarget(root, path, await readlink(join(root, path))));
      else if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit('');
  return { files: files.sort(), links };
}

export function fsReader(root: string): RepoReader {
  let listing: Promise<Listing> | undefined;
  const list = () => (listing ??= isGitWorkTree(root).then((inGit) => (inGit ? listGitWorkTree(root) : walk(root))));

  return {
    root,
    ref: null,
    async listFiles() {
      return (await list()).files;
    },
    async readFile(path) {
      try {
        return await readFile(join(root, path));
      } catch (err) {
        if (isMissing(err)) throw new FileNotFound(path);
        throw err;
      }
    },
    async exists(path) {
      try {
        await stat(join(root, path));
        return true;
      } catch (err) {
        if (isMissing(err)) return false;
        throw err;
      }
    },
    async listSymlinks() {
      return (await list()).links;
    },
  };
}

export async function gitReader(root: string, ref: string): Promise<RepoReader> {
  let sha: string;
  try {
    sha = (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
  } catch (err) {
    if (exitedNonZero(err)) throw new RefNotFound(ref);
    throw err;
  }

  const files: string[] = [];
  const linkBlobs = new Map<string, string>();
  for (const entry of nulSplit(await git(root, ['ls-tree', '-r', '-z', '--full-tree', sha]))) {
    const tab = entry.indexOf('\t');
    const [mode, type, object] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (type !== 'blob' || skipped(path)) continue;
    if (mode === '120000') linkBlobs.set(path, object!);
    else files.push(path);
  }
  files.sort();
  const fileSet = new Set(files);

  return {
    root,
    ref,
    async listFiles() {
      return files;
    },
    async readFile(path) {
      if (!fileSet.has(path)) throw new FileNotFound(path);
      return gitBuffer(root, ['cat-file', 'blob', `${sha}:${path}`]);
    },
    async exists(path) {
      return fileSet.has(path) || files.some((f) => f.startsWith(`${path}/`));
    },
    async listSymlinks() {
      const links = new Map<string, string | null>();
      for (const [path, object] of linkBlobs) {
        links.set(path, resolveGitTarget(path, await git(root, ['cat-file', 'blob', object])));
      }
      return links;
    },
  };
}
