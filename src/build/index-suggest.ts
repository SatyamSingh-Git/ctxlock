import { posix } from 'node:path';
import type { RepoReader } from '../repo/reader.js';

export class BuildError extends Error {}

// The compressed docs index from Vercel's "AGENTS.md outperforms skills" (January 2026), in the format
// of Next.js's agents-md codemod: vercel/next.js packages/next-codemod/lib/agents-md.ts at 1e859c0
// (MIT). Its "If docs missing" line is left out, since these docs are in the repository already.
// `dir` is from the repository's top, '' for the top itself.
export async function suggestIndex(reader: RepoReader, dir: string): Promise<{ text: string; bytes: number }> {
  const files = (await reader.listFiles())
    .filter((p) => (dir === '' || p.startsWith(`${dir}/`)) && /\.mdx?$/.test(p))
    .map((p) => (dir === '' ? p : p.slice(dir.length + 1)));
  if (files.length === 0) throw new BuildError(`no markdown files under ${dir || '.'}`);

  const folders = new Map<string, string[]>();
  for (const file of files) {
    const folder = posix.dirname(file);
    folders.set(folder, [...(folders.get(folder) ?? []), posix.basename(file)]);
  }
  const parts = [`[${dir || '.'} index]`, `root: ${dir ? `./${dir}` : '.'}`, 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning'];
  for (const [folder, names] of [...folders].sort(([a], [b]) => (a < b ? -1 : 1))) parts.push(`${folder}:{${names.join(',')}}`);
  const text = parts.join('|');
  return { text, bytes: Buffer.byteLength(text) };
}
