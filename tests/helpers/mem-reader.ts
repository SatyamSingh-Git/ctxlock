import { FileNotFound, type RepoReader } from '../../src/repo/reader.js';

export type MemReader = RepoReader & { reads: number };

export function memReader(
  files: Record<string, string | Buffer>,
  symlinks: Record<string, string | null> = {},
): MemReader {
  const paths = Object.keys(files).sort();
  const reader: MemReader = {
    root: '/mem',
    ref: null,
    reads: 0,
    async listFiles() {
      return paths;
    },
    async readFile(path) {
      const content = files[path];
      if (content === undefined) throw new FileNotFound(path);
      reader.reads++;
      return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    },
    async exists(path) {
      return path in files || paths.some((p) => p.startsWith(`${path}/`));
    },
    async listSymlinks() {
      return new Map(Object.entries(symlinks));
    },
    async readAll(onFile) {
      for (const path of paths) await onFile(path, await reader.readFile(path));
    },
  };
  return reader;
}
