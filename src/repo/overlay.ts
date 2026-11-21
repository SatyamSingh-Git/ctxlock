import { FileNotFound, type RepoReader } from './reader.js';

// The repository with files added or replaced in memory, and files or folders taken out: what a scan
// sees once they are written, or deleted.
export function overlayReader(base: RepoReader, added: Map<string, Buffer>, removed: Set<string> = new Set()): RepoReader {
  const gone = (path: string) => !added.has(path) && [...removed].some((r) => path === r || path.startsWith(`${r}/`));
  const reader: RepoReader = {
    root: base.root,
    ref: base.ref,
    async listFiles() {
      return [...new Set([...(await base.listFiles()).filter((p) => !gone(p)), ...added.keys()])].sort();
    },
    async readFile(path) {
      if (gone(path)) throw new FileNotFound(path);
      return added.get(path) ?? base.readFile(path);
    },
    async exists(path) {
      return added.has(path) || [...added.keys()].some((p) => p.startsWith(`${path}/`)) || (!gone(path) && (await base.exists(path)));
    },
    listSymlinks: async () => new Map([...(await base.listSymlinks())].filter(([link]) => !gone(link))),
    async readAll(onFile) {
      for (const path of await reader.listFiles()) await onFile(path, await reader.readFile(path));
    },
  };
  return reader;
}
