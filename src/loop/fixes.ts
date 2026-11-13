import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProbes, type Probe } from '../eval/probes.js';
import type { Unit, UnitFile } from '../model.js';
import { fsReader, gitTopLevel } from '../repo/reader.js';
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

// Each <commit>:<path> as bytes, or null where it isn't there, through one git process: a unit edited
// hundreds of times since its fix would otherwise list the whole tree once a version.
function blobs(top: string, specs: string[]): Array<Buffer | null> {
  const r = spawnSync('git', ['-C', top, 'cat-file', '--batch'], { input: specs.map((s) => `${s}\n`).join(''), maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) throw r.error;
  const out = r.stdout;
  let at = 0;
  return specs.map(() => {
    const end = out.indexOf(0x0a, at);
    const header = out.subarray(at, end).toString();
    at = end + 1;
    if (header.endsWith(' missing')) return null;
    const size = Number(header.slice(header.lastIndexOf(' ') + 1));
    const bytes = out.subarray(at, at + size);
    at += size + 1;
    return bytes;
  });
}

// The unit's files at each commit, or null where its first file wasn't there.
function versionsAt(top: string, unit: Unit, at: Array<readonly [string, string]>): Array<Version | null> {
  const read = blobs(top, at.flatMap(([commit]) => unit.files.map((f) => `${commit}:${f.path}`)));
  return at.map(([commit, when], i) => {
    const files: UnitFile[] = [];
    unit.files.forEach((f, j) => {
      const bytes = read[i * unit.files.length + j];
      if (bytes) files.push({ path: f.path, bytes: bytes.length, sha256: lfDigest(bytes) });
    });
    return read[i * unit.files.length] ? { commit, at: when, file: files[0]!.sha256, unit: unitDigest(files) } : null;
  });
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
  // HEAD's first-parent line, oldest first.
  const mainline = (await git(top, ['rev-list', '--reverse', '--first-parent', 'HEAD'])).split('\n').filter(Boolean);
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
    const [commit, committedAt] = first;
    // A commit made on a branch shipped when it reached HEAD's first-parent line: at the oldest commit there
    // that descends from it, a merge's. --first-parent can't be asked here, as --ancestry-path would then
    // follow first parents only and lose a merge of a longer branch.
    let shippedAt = committedAt;
    if (!mainline.includes(commit)) {
      const descendants = new Set((await git(top, ['rev-list', '--ancestry-path', `${commit}..HEAD`])).split('\n').filter(Boolean));
      const merge = mainline.find((c) => descendants.has(c));
      if (merge) shippedAt = (await git(top, ['show', '-s', '--format=%cI', merge])).trim();
    }
    // Only commits that descend from the fix: a branch that forked before it and merged later never had it.
    const later = commits(await git(top, ['log', '--reverse', '--ancestry-path', '--format=%H%x09%cI', `${commit}..HEAD`, '--', ...unit.files.map((f) => f.path)]));
    const parent = (await git(top, ['rev-list', '--parents', '-n', '1', commit])).trim().split(' ')[1];
    const found = versionsAt(top, unit, [...(parent ? [[parent, ''] as const] : []), [commit, committedAt], ...later]);
    const before = parent ? found.shift()! : null;
    const versions: Version[] = [];
    for (const v of [...found, { commit: null, at: null, file: unit.files[0]!.sha256, unit: unit.digest }]) {
      if (v && !versions.some((w) => w.unit === v.unit)) versions.push(v);
    }
    fixes.push({ probe, unit: unit.id, commit, shippedAt, unchanged: before?.unit === versions[0]?.unit, versions });
  }
  return { fixes, orphans, git: true };
}
