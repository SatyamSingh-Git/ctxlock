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
  units: UnitMiss[];
}

const none = (): Record<SignalKind, number> => ({ interrupted: 0, correction: 0 });

const ids = (loads: SessionLoad[]) => [...new Set(loads.map((l) => l.unit.id))].sort();

// D80: everything loaded before the signal was in context. Its turn runs from the person's prompt before
// it; loads before the first prompt belong to the first turn.
function inPlay(loads: SessionLoad[], prompts: string[], ts: string): { context: string[]; turn: string[] } {
  const before = prompts.filter((p) => p < ts);
  const start = before.length > 1 ? before.at(-1)! : '';
  const loaded = loads.filter((l) => l.ts <= ts);
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
  const reached = new Map<string, MissSignal[]>();

  for (const timeline of kept) {
    const transcript = transcripts.get(timeline.session);
    if (!transcript) continue;
    withTranscript++;
    if (transcript.signals.length > 0) withSignal++;
    for (const s of transcript.signals) {
      signals[s.kind]++;
      if (s.untrusted) untrusted++;
      if (s.ts < timeline.begun) {
        unrecorded++;
        continue;
      }
      const { context, turn } = inPlay(timeline.loads, transcript.prompts, s.ts);
      if (context.length === 0) unattributed++;
      const signal: MissSignal = { session: timeline.session, kind: s.kind, ts: s.ts, untrusted: s.untrusted, ...(s.words !== undefined && { words: s.words }), context, turn };
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

  return { sessions: kept.length, withTranscript, withSignal, signals, untrusted, unattributed, unrecorded, since: opts.since ?? null, minSessions: opts.minSessions, units };
}
