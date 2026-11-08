import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Unit } from '../model.js';
import type { ScanResult } from '../scan.js';
import { lfDigest, unitDigest } from '../units/digest.js';
import type { Transcript } from './claude.js';

// The design's context.load event (spec §4.3), without the session and time.
export interface LoadRecord {
  unit_id: string;
  // null when the bytes in the run differ from the scanned unit.
  unit_digest: string | null;
  // session_start, import, nested, glob, skill_listed or skill_invoked; a reason Claude Code adds later passes through.
  load_reason: string;
  trigger_file?: string;
  // false: predicted, because Claude Code reports no event for it (D37).
  observed: boolean;
}

const REASONS: Record<string, string> = { session_start: 'session_start', include: 'import', nested_traversal: 'nested', path_glob_match: 'glob' };

function digestIn(dir: string, unit: Unit): string | null {
  if (!unit.files.every((f) => existsSync(join(dir, f.path)))) return null;
  const digest = unitDigest(unit.files.map((f) => ({ ...f, sha256: lfDigest(readFileSync(join(dir, f.path))) })));
  return digest === unit.digest ? digest : null;
}

export function joinLoads(t: Transcript, scan: ScanResult, dir: string): LoadRecord[] {
  const byPath = new Map<string, Unit>();
  for (const unit of scan.units) for (const p of [unit.path, ...unit.aliases]) byPath.set(p, unit);
  const byId = new Map(scan.units.map((u) => [u.id, u]));
  const records: LoadRecord[] = [];
  const observed = new Set<string>();

  for (const load of t.loads) {
    const unit = byPath.get(load.path);
    if (!unit) continue;
    observed.add(unit.id);
    records.push({
      unit_id: unit.id,
      unit_digest: digestIn(dir, unit),
      load_reason: REASONS[load.reason] ?? load.reason,
      ...(load.trigger ? { trigger_file: load.trigger } : {}),
      observed: true,
    });
  }

  const root = scan.contexts.find((c) => c.harness === 'claude-code' && c.site === '');
  const listed = (root?.entries ?? []).filter((e) => e.mode === 'listed').map((e) => byId.get(e.unitId)!);
  for (const [names, reason] of [[t.listedSkills, 'skill_listed'], [t.skills, 'skill_invoked']] as const) {
    for (const unit of listed) {
      if (names.includes(unit.name)) records.push({ unit_id: unit.id, unit_digest: unit.digest, load_reason: reason, observed: true });
    }
  }

  // Claude Code reads AGENTS.md through a plugin when a project has no CLAUDE.md, and reports it
  // nowhere, though the agent follows it. Those loads, and what they import, come from the prediction.
  const predicted = new Set<string>();
  for (const entry of root?.entries ?? []) {
    if (entry.mode !== 'always') continue;
    const from = entry.reason.startsWith('import:') ? entry.reason.slice('import:'.length) : null;
    if (entry.reason !== 'agents-md-fallback' && !(from !== null && predicted.has(from))) continue;
    const unit = byId.get(entry.unitId);
    if (!unit || observed.has(unit.id)) continue;
    predicted.add(entry.path);
    records.push({ unit_id: unit.id, unit_digest: unit.digest, load_reason: from === null ? 'session_start' : 'import', observed: false });
  }
  return records;
}
