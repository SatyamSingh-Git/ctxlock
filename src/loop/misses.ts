import type { SessionLoad, Timeline } from '../collect/sessions.js';
import { unitOwners } from '../registry/codeowners.js';
import { localDate, type ScanResult } from '../scan.js';
import type { SessionTranscript, SignalKind } from './transcript.js';

export interface MissSignal {
  session: string;
  kind: SignalKind;
  ts: string;
  untrusted: boolean;
  words?: string;
  // The units loaded in the session before the signal: Claude Code keeps a loaded file in context.
  context: string[];
  // Of those, the ones loaded in the signal's own turn.
  turn: string[];
  // Before the collector's first record of the session, so context is unknown and joined to nothing.
  unrecorded?: true;
}

export interface UnitMiss {
  id: string;
  path: string;
  // Its digest as scanned now.
  digest: string;
  owners: string[];
  // From ctxlock.lock, for a unit synced from an upstream: its owner is there.
  upstream: { name: string; repo: string } | null;
  // Distinct sessions with a signal while it was in context: 1 each, or 0.5 when all of them came after
  // untrusted content.
  sessions: number;
  // Of those sessions, the ones counted at half.
  halved: number;
  // Signals that came in the turn it loaded.
  inTurn: number;
  loadedIn: number;
  everySession: boolean;
  // Of those sessions, the ones that loaded bytes other than today's.
  olderVersion: number;
  kinds: Record<SignalKind, number>;
  first: string;
  last: string;
  routed: boolean;
  signals: MissSignal[];
}

export interface Misses {
  sessions: number;
  withTranscript: number;
  withSignal: number;
  signals: Record<SignalKind, number>;
  untrusted: number;
  // Signals with no unit of the repository in context.
  unattributed: number;
  // Signals before the collector's first record of their session: what was in context is unknown.
  unrecorded: number;
  since: string | null;
  minSessions: number;
  // Every signal, joined to a unit or not, in the order the sessions are read.
  found: MissSignal[];
  units: UnitMiss[];
}

const none = (): Record<SignalKind, number> => ({ interrupted: 0, correction: 0 });

const ids = (loads: SessionLoad[]) => [...new Set(loads.map((l) => l.unit.id))].sort();

// D80a: everything loaded since the last compaction before the signal was in context. Claude Code loads
// instruction files again when it compacts, and the collector sees that; a predicted load it can't see,
// so that one stays. The turn runs from the person's prompt before the signal; loads before the first
// prompt belong to the first turn.
function inPlay(loads: SessionLoad[], t: SessionTranscript, ts: string): { context: string[]; turn: string[] } {
  const before = t.prompts.filter((p) => p < ts);
  const start = before.length > 1 ? before.at(-1)! : '';
  const compacted = t.compactions.filter((c) => c < ts).at(-1) ?? '';
  const loaded = loads.filter((l) => l.ts <= ts && (l.ts >= compacted || !l.observed));
  return { context: ids(loaded), turn: ids(loaded.filter((l) => l.ts >= start)) };
}

export function findMisses(timelines: Timeline[], transcripts: Map<string, SessionTranscript>, scan: ScanResult, opts: { minSessions: number; since?: string }): Misses {
  // A date the person gives is theirs, not UTC's.
  const kept = timelines.filter((t) => opts.since === undefined || localDate(new Date(t.begun)) >= opts.since);
  const byId = new Map(scan.units.map((u) => [u.id, u]));
  const signals = none();
  let withTranscript = 0;
  let withSignal = 0;
  let untrusted = 0;
  let unattributed = 0;
  let unrecorded = 0;
  const found: MissSignal[] = [];
  const reached = new Map<string, MissSignal[]>();

  for (const timeline of kept) {
    const transcript = transcripts.get(timeline.session);
    if (!transcript) continue;
    withTranscript++;
    if (transcript.signals.length > 0) withSignal++;
    for (const s of transcript.signals) {
      signals[s.kind]++;
      if (s.untrusted) untrusted++;
      const said = { session: timeline.session, kind: s.kind, ts: s.ts, untrusted: s.untrusted, ...(s.words !== undefined && { words: s.words }) };
      if (s.ts < timeline.begun) {
        unrecorded++;
        found.push({ ...said, context: [], turn: [], unrecorded: true });
        continue;
      }
      const { context, turn } = inPlay(timeline.loads, transcript, s.ts);
      if (context.length === 0) unattributed++;
      const signal: MissSignal = { ...said, context, turn };
      found.push(signal);
      for (const id of context) reached.set(id, [...(reached.get(id) ?? []), signal]);
    }
  }

  const units = [...reached].map(([id, hits]): UnitMiss => {
    const unit = byId.get(id)!;
    const sessions = new Map<string, boolean>();
    for (const h of hits) sessions.set(h.session, (sessions.get(h.session) ?? false) || !h.untrusted);
    const halved = [...sessions.values()].filter((trusted) => !trusted).length;
    const weight = sessions.size - halved / 2;
    const loadedIn = kept.filter((t) => t.loads.some((l) => l.unit.id === id)).length;
    const olderVersion = kept.filter((t) => sessions.has(t.session) && t.loads.some((l) => l.unit.id === id && l.other)).length;
    const kinds = none();
    for (const h of hits) kinds[h.kind]++;
    const stamps = hits.map((h) => h.ts).sort();
    const pinned = scan.lock.upstreams.find((u) => u.units.some((x) => x.path === unit.path));
    return {
      id,
      path: unit.path,
      digest: unit.digest,
      owners: unitOwners(unit, scan.registry, scan.codeowners),
      upstream: pinned ? { name: pinned.name, repo: pinned.repo } : null,
      sessions: weight,
      halved,
      inTurn: hits.filter((h) => h.turn.includes(id)).length,
      loadedIn,
      everySession: loadedIn === kept.length,
      olderVersion,
      kinds,
      first: stamps[0]!,
      last: stamps.at(-1)!,
      routed: weight >= opts.minSessions,
      signals: hits,
    };
  });
  units.sort((a, b) => b.sessions - a.sessions || (a.path < b.path ? -1 : 1));

  return { sessions: kept.length, withTranscript, withSignal, signals, untrusted, unattributed, unrecorded, since: opts.since ?? null, minSessions: opts.minSessions, found, units };
}
