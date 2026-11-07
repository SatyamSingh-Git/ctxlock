import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import ignore, { type Ignore } from 'ignore';

const exec = promisify(execFile);

// Whether a path is ignored by the repository's own .gitignore files, read from the path's folder up
// to the root. `files` is the repository's file list; the user's global excludes are not read.
export function gitignoreMatcher(files: Set<string>, read: (path: string) => Promise<Buffer>): (path: string) => Promise<boolean> {
  const parsed = new Map<string, Ignore>();
  return async (path) => {
    for (let d = posix.dirname(path); ; d = posix.dirname(d)) {
      const base = d === '.' ? '' : d;
      const file = base ? `${base}/.gitignore` : '.gitignore';
      if (files.has(file)) {
        if (!parsed.has(file)) parsed.set(file, ignore().add((await read(file)).toString('utf8')));
        if (parsed.get(file)!.ignores(base ? path.slice(base.length + 1) : path)) return true;
      }
      if (base === '') return false;
    }
  };
}

// The paths among these that git would not add in the work tree at top, by every rule git reads:
// .gitignore files, .git/info/exclude and core.excludesFile. A tracked file is never ignored.
export async function gitIgnored(top: string, paths: string[]): Promise<Set<string>> {
  const run = exec('git', ['-C', top, 'check-ignore', '--stdin', '-z'], { encoding: 'utf8' });
  run.child.stdin!.end(paths.join('\0'));
  try {
    return new Set((await run).stdout.split('\0').filter(Boolean));
  } catch (err) {
    // check-ignore exits 1 when it ignores none of them.
    if ((err as { code?: unknown }).code === 1) return new Set();
    throw err;
  }
}
