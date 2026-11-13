import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProbes, type Probe } from '../eval/probes.js';
import type { Unit, UnitFile } from '../model.js';
import { fsReader, gitReader, gitTopLevel } from '../repo/reader.js';
import type { ScanResult } from '../scan.js';
import { lfDigest, unitDigest } from '../units/digest.js';

const exec = promisify(execFile);

export class FixesError extends Error {}

// A version of the unit: file is its first file's LF digest, which the collector's loads are compared
// by; unit is its digest, which a lock pins. A null commit is the working tree.
export interface Version {
  commit: string | null;
  at: string | null;
  file: string;
  unit: string;
}

export interface ShippedFix {
  probe: Probe;
  unit: string;
  commit: string;
  shippedAt: string;
  // The commit added the probe and left the unit as it was.
  unchanged: boolean;
  // From the fix on, oldest first.
  versions: Version[];
}

export interface Fixes {
  fixes: ShippedFix[];
  orphans: Probe[];
  git: boolean;
}

const git = async (root: string, args: string[]) => (await exec('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
const commits = (out: string) =>
  out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string]);

// The unit's files as they were at a commit, or null when its first file wasn't there.
async function versionAt(root: string, unit: Unit, commit: string, at: string): Promise<Version | null> {
  const reader = await gitReader(root, commit);
  const files: UnitFile[] = [];
  for (const f of unit.files) {
    if (!(await reader.exists(f.path))) {
      if (f === unit.files[0]) return null;
      continue;
    }
    const bytes = await reader.readFile(f.path);
    files.push({ path: f.path, bytes: bytes.length, sha256: lfDigest(bytes) });
  }
  return { commit, at, file: files[0]!.sha256, unit: unitDigest(files) };
}

// D90: a fix ships with the commit that first adds the probe diagnose wrote for it.
export async function shippedFixes(root: string, scan: ScanResult): Promise<Fixes> {
  // Paths are the top's, as the reader lists them, so git runs there too.
  const top = await gitTopLevel(root);
  if (top === null) return { fixes: [], orphans: [], git: false };
  if ((await git(top, ['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
    throw new FixesError('the history is shallow, so when a probe arrived is unknown; run git fetch --unshallow');
  }
  const units = new Map(scan.units.map((u) => [u.id, u]));
  const fixes: ShippedFix[] = [];
  const orphans: Probe[] = [];
  for (const probe of (await loadProbes(fsReader(root))).filter((p) => p.id.startsWith('miss-'))) {
    const unit = units.get(probe.unit);
    if (!unit) {
      orphans.push(probe);
      continue;
    }
    // -S finds each commit that changes how often the id occurs: the oldest is when it first arrived.
    const [first] = commits(await git(top, ['log', '--reverse', '--format=%H%x09%cI', `-S${probe.id}`, '--', 'evals/probes']));
    if (!first) continue;
    const [commit, shippedAt] = first;
    // Only commits that descend from the fix: a branch that forked before it and merged later never had it.
    const later = commits(await git(top, ['log', '--reverse', '--ancestry-path', '--format=%H%x09%cI', `${commit}..HEAD`, '--', ...unit.files.map((f) => f.path)]));
    const found = await Promise.all([[commit, shippedAt] as const, ...later].map(([c, at]) => versionAt(top, unit, c, at)));
    const versions: Version[] = [];
    for (const v of [...found, { commit: null, at: null, file: unit.files[0]!.sha256, unit: unit.digest }]) {
      if (v && !versions.some((w) => w.unit === v.unit)) versions.push(v);
    }
    const parent = (await git(top, ['rev-list', '--parents', '-n', '1', commit])).trim().split(' ')[1];
    const before = parent ? await versionAt(top, unit, parent, '') : null;
    fixes.push({ probe, unit: unit.id, commit, shippedAt, unchanged: before?.unit === versions[0]?.unit, versions });
  }
  return { fixes, orphans, git: true };
}
