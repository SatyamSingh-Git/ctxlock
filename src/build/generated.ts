import { z } from 'zod';
import { describeIssue } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';
import { lfDigest } from '../units/digest.js';

// What ctxlock build generated, and from what. Generated files carry no marker of their own.
export const GENERATED_FILE = '.ctxlock/generated.json';

export interface Source {
  path: string;
  sha256: string;
}

export interface GeneratedFile {
  path: string;
  sha256: string;
  from: Source[];
}

export interface Generated {
  files: GeneratedFile[];
  error: string | null;
}

export type GeneratedState = 'ok' | 'missing' | 'edited' | 'source-missing' | 'stale';

// A path as git lists it: inside the repository, so nothing read or written through it can leave it.
const insidePath = z
  .string()
  .refine((p) => p !== '' && !p.includes('\\') && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').includes('..'), {
    error: (issue) => `${String(issue.input)} is not a path inside the repository`,
  });

const schema = z.strictObject({
  version: z.literal(1),
  files: z.array(z.strictObject({ path: insidePath, sha256: z.string(), from: z.array(z.strictObject({ path: insidePath, sha256: z.string() })) })),
});

export async function loadGenerated(reader: RepoReader): Promise<Generated> {
  if (!(await reader.exists(GENERATED_FILE))) return { files: [], error: null };
  let raw: unknown;
  try {
    raw = JSON.parse((await reader.readFile(GENERATED_FILE)).toString('utf8'));
  } catch (err) {
    return { files: [], error: `not JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(raw);
  if (!result.success) return { files: [], error: result.error.issues.map(describeIssue).join('; ') };
  return { files: result.data.files, error: null };
}

export function serializeGenerated(files: GeneratedFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return `${JSON.stringify({ version: 1, files: sorted }, null, 2)}\n`;
}

// The same digest as a unit file's, so a CRLF checkout and an LF one read one record alike.
const current = async (reader: RepoReader, path: string) => ((await reader.exists(path)) ? lfDigest(await reader.readFile(path)) : null);

export async function generatedStatus(reader: RepoReader, files: GeneratedFile[]): Promise<Array<{ path: string; state: GeneratedState; source?: string }>> {
  const out: Array<{ path: string; state: GeneratedState; source?: string }> = [];
  for (const file of files) {
    const sha = await current(reader, file.path);
    if (sha === null) out.push({ path: file.path, state: 'missing' });
    else if (sha !== file.sha256) out.push({ path: file.path, state: 'edited' });
    else {
      const sources = await Promise.all(file.from.map(async (s) => ({ path: s.path, recorded: s.sha256, now: await current(reader, s.path) })));
      const gone = sources.find((s) => s.now === null);
      const changed = sources.find((s) => s.now !== s.recorded);
      if (gone) out.push({ path: file.path, state: 'source-missing', source: gone.path });
      else if (changed) out.push({ path: file.path, state: 'stale', source: changed.path });
      else out.push({ path: file.path, state: 'ok' });
    }
  }
  return out;
}
