import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { TIERS, type Tier } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';

// What sync took from each upstream, pinned: the commit, and every unit's digest and files (D70, after
// APM's apm.lock.yaml). File digests read CRLF as LF, as unit digests do.
export const LOCK_FILE = 'ctxlock.lock';

export interface LockedUnit {
  path: string;
  id: string;
  digest: string;
  tier: Tier;
  files: Record<string, string>;
}

export interface LockedUpstream {
  name: string;
  repo: string;
  ref: string;
  commit: string;
  units: LockedUnit[];
}

export interface Lock {
  upstreams: LockedUpstream[];
}

export class LockError extends Error {}

const schema = z.strictObject({
  lockfile_version: z.literal(1),
  upstreams: z.array(
    z.strictObject({
      name: z.string(),
      repo: z.string(),
      ref: z.string(),
      commit: z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-character commit'),
      units: z.array(
        z.strictObject({
          path: z.string(),
          id: z.string(),
          digest: z.string(),
          tier: z.enum(TIERS),
          files: z.record(z.string(), z.string()),
        }),
      ),
    }),
  ),
});

const byKey = <T>(key: (t: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

export async function loadLock(reader: RepoReader): Promise<Lock> {
  if (!(await reader.exists(LOCK_FILE))) return { upstreams: [] };
  let raw: unknown;
  try {
    raw = parse((await reader.readFile(LOCK_FILE)).toString('utf8'));
  } catch (err) {
    throw new LockError(`${LOCK_FILE}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new LockError(`${LOCK_FILE}: ${result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return { upstreams: result.data.upstreams };
}

// Sorted throughout, so the same lock always reads the same and a diff shows only what changed.
export function serializeLock(lock: Lock): string {
  const upstreams = [...lock.upstreams].sort(byKey((u) => u.name)).map((u) => ({
    name: u.name,
    repo: u.repo,
    ref: u.ref,
    commit: u.commit,
    units: [...u.units].sort(byKey((x) => x.path)).map((x) => ({
      path: x.path,
      id: x.id,
      digest: x.digest,
      tier: x.tier,
      files: Object.fromEntries(Object.entries(x.files).sort(byKey(([path]) => path))),
    })),
  }));
  return stringify({ lockfile_version: 1, upstreams });
}

// For lint, which reports a lock it cannot read rather than stopping on it.
export async function readLock(reader: RepoReader): Promise<{ lock: Lock; error: string | null }> {
  try {
    return { lock: await loadLock(reader), error: null };
  } catch (err) {
    if (!(err instanceof LockError)) throw err;
    return { lock: { upstreams: [] }, error: err.message };
  }
}
