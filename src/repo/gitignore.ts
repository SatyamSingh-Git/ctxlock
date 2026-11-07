import { posix } from 'node:path';
import ignore, { type Ignore } from 'ignore';

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
