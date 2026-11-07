import type { RepoReader } from './reader.js';

// The repository with files added or replaced in memory: what a scan sees once they are written.
export function overlayReader(base: RepoReader, added: Map<string, Buffer>): RepoReader {
  const reader: RepoReader = {
    root: base.root,
    ref: base.ref,
    async listFiles() {
      return [...new Set([...(await base.listFiles()), ...added.keys()])].sort();
    },
    async readFile(path) {
      return added.get(path) ?? base.readFile(path);
    },
    async exists(path) {
      return added.has(path) || [...added.keys()].some((p) => p.startsWith(`${path}/`)) || base.exists(path);
    },
    listSymlinks: () => base.listSymlinks(),
    async readAll(onFile) {
      for (const path of await reader.listFiles()) await onFile(path, await reader.readFile(path));
    },
  };
  return reader;
}
