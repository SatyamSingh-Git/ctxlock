import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

// Paths are POSIX and relative to the repository's top level, or to root outside git.
// Only listed files can be read: a symlink is never read through, wherever it points.
export interface RepoReader {
  readonly root: string;
  readonly ref: string | null;
  listFiles(): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  listSymlinks(): Promise<Map<string, string | null>>;
  // Every listed file, in listFiles() order. Copying a whole tree file by file through readFile would
  // start one git process per file.
  readAll(onFile: (path: string, bytes: Buffer) => void | Promise<void>): Promise<void>;
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
  top: string;
  files: string[];
  fileSet: Set<string>;
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

export async function gitTopLevel(root: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  } catch (err) {
    if (exitedNonZero(err)) return null;
    throw err;
  }
}

function listing(top: string, files: string[], links: Map<string, string | null>): Listing {
  files.sort();
  return { top, files, fileSet: new Set(files), links };
}

async function listGitWorkTree(root: string, local: boolean): Promise<Listing> {
  const [staged, untracked, deletedOut, localOut] = await Promise.all([
    git(root, ['ls-files', '-z', '-s', '-t']),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard']),
    git(root, ['ls-files', '-z', '--deleted']),
    // CLAUDE.local.md and .claude/settings.local.json are usually gitignored, yet Claude Code still uses them on this machine.
    local ? git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ':(glob)**/CLAUDE.local.md', '.claude/settings.local.json']) : '',
  ]);
  const deleted = new Set(nulSplit(deletedOut));
  const files = new Set<string>();
  const links = new Map<string, string | null>();

  for (const entry of nulSplit(staged)) {
    const tab = entry.indexOf('\t');
    const [tag, mode, object] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    // S is skip-worktree: a sparse checkout left the file out of the working tree.
    if (tag === 'S' || deleted.has(path) || skipped(path) || mode === '160000') continue;
    if (mode === '120000') links.set(path, resolveGitTarget(path, await git(root, ['cat-file', 'blob', object!])));
    else files.add(path);
  }

  for (const path of nulSplit(untracked)) {
    // A trailing slash is a nested repository, which git does not descend into.
    if (path.endsWith('/') || skipped(path)) continue;
    if ((await lstat(join(root, path))).isSymbolicLink()) {
      links.set(path, resolveFsTarget(root, path, await readlink(join(root, path))));
    } else {
      files.add(path);
    }
  }
  for (const path of nulSplit(localOut)) if (!skipped(path)) files.add(path);

  return listing(root, [...files], links);
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
  return listing(root, files, links);
}

// `local: false` leaves out the gitignored files only this machine has, for a working tree that
// stands in for a commit.
export function fsReader(root: string, { local = true } = {}): RepoReader {
  let cached: Promise<Listing> | undefined;
  const list = () => (cached ??= gitTopLevel(root).then((top) => (top ? listGitWorkTree(top, local) : walk(root))));

  return {
    root,
    ref: null,
    async listFiles() {
      return (await list()).files;
    },
    async readFile(path) {
      const { top, fileSet } = await list();
      if (!fileSet.has(path)) throw new FileNotFound(path);
      return readFile(join(top, path));
    },
    async exists(path) {
      const { files, fileSet } = await list();
      return fileSet.has(path) || files.some((f) => f.startsWith(`${path}/`));
    },
    async listSymlinks() {
      return (await list()).links;
    },
    async readAll(onFile) {
      const { top, files } = await list();
      for (const path of files) await onFile(path, await readFile(join(top, path)));
    },
  };
}

// Parses `git cat-file --batch` output: "<oid> blob <size>\n<bytes>\n" per object asked for.
async function* batchBlobs(stdout: Readable, count: number): AsyncGenerator<Buffer> {
  const chunks = stdout[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  let buf: Buffer = Buffer.alloc(0);
  const fill = async (length: number) => {
    const parts: Buffer[] = [buf];
    let have = buf.length;
    while (have < length) {
      const next = await chunks.next();
      if (next.done) throw new Error('git cat-file --batch ended early');
      parts.push(next.value);
      have += next.value.length;
    }
    if (parts.length > 1) buf = Buffer.concat(parts, have);
  };
  for (let i = 0; i < count; i++) {
    let nl: number;
    while ((nl = buf.indexOf(10)) < 0) await fill(buf.length + 1);
    const header = buf.subarray(0, nl).toString('utf8');
    const size = / blob (\d+)$/.exec(header)?.[1];
    if (size === undefined) throw new Error(`git cat-file --batch: ${header}`);
    const end = nl + 1 + Number(size);
    await fill(end + 1);
    yield buf.subarray(nl + 1, end);
    buf = buf.subarray(end + 1);
  }
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
  const objects = new Map<string, string>();
  const linkBlobs = new Map<string, string>();
  for (const entry of nulSplit(await git(root, ['ls-tree', '-r', '-z', '--full-tree', sha]))) {
    const tab = entry.indexOf('\t');
    const [mode, type, object] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (type !== 'blob' || skipped(path)) continue;
    if (mode === '120000') linkBlobs.set(path, object!);
    else {
      files.push(path);
      objects.set(path, object!);
    }
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
    async readAll(onFile) {
      const child = spawn('git', ['-C', root, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const closed = once(child, 'close');
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.stdin.end(files.map((path) => `${objects.get(path)}\n`).join(''));
      let i = 0;
      try {
        for await (const bytes of batchBlobs(child.stdout, files.length)) await onFile(files[i++]!, bytes);
      } catch (err) {
        // Otherwise git blocks on a pipe nobody reads any more, and ctxlock cannot exit. With the
        // pipe closed, git's next write fails and it exits.
        child.stdout.destroy();
        await closed;
        throw err;
      }
      const [code] = await closed;
      if (code !== 0) throw new Error(`git cat-file --batch exited ${code}: ${stderr.trim()}`);
    },
  };
}
