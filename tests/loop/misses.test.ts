import { describe, expect, it, vi } from 'vitest';
import type { SessionLoad, Timeline } from '../../src/collect/sessions.js';
import { findMisses } from '../../src/loop/misses.js';
import type { SessionTranscript, Signal } from '../../src/loop/transcript.js';
import { scanRepo } from '../../src/scan.js';
import { serializeLock } from '../../src/sync/lock.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';

const t = (minute: number) => `2026-11-11T10:${String(minute).padStart(2, '0')}:00.000Z`;
const TESTING = 'Run pnpm test.\n';
const FILES = {
  'CLAUDE.md': 'c\n',
  '.claude/rules/api.md': 'API rule\n',
  '.claude/rules/db.md': 'DB rule\n',
  '.claude/rules/testing.md': TESTING,
  '.github/CODEOWNERS': '.claude/rules/db.md @db-team\n',
  'ctxlock.yaml': 'version: 1\nunits:\n  .claude/rules/api.md:\n    owner: "@api-team"\nupstream:\n  platform:\n    repo: https://github.com/acme/context.git\n    units: [.claude/rules/testing.md]\n',
  'ctxlock.lock': serializeLock({
    upstreams: [
      {
        name: 'platform',
        repo: 'https://github.com/acme/context.git',
        ref: 'main',
        commit: 'abcdef1'.padEnd(40, '0'),
        units: [{ path: '.claude/rules/testing.md', id: 'rule/.claude/rules/testing.md', digest: `sha256:${'b'.repeat(64)}`, tier: 'reviewed', files: { '.claude/rules/testing.md': lfDigest(Buffer.from(TESTING)) } }],
      },
    ],
  }),
};

const CLAUDE = 'instructions/CLAUDE.md';
const API = 'rule/.claude/rules/api.md';
const DB = 'rule/.claude/rules/db.md';
const TEST = 'rule/.claude/rules/testing.md';

async function setup() {
  const scan = await scanRepo(memReader(FILES));
  const unit = (id: string) => scan.units.find((u) => u.id === id)!;
  const load = (id: string, minute: number, other = false): SessionLoad => ({ unit: unit(id), ts: t(minute), reason: 'glob', other, observed: true });
  const timeline = (session: string, begun: number, loads: SessionLoad[]): Timeline => ({ session, folder: '', begun: t(begun), last: t(59), loads, seeable: [] });
  return { scan, load, timeline };
}

const said = (session: string, prompts: number[], signals: Array<Partial<Signal> & { kind: Signal['kind']; ts: string }>, compactions: number[] = []): [string, SessionTranscript] => [
  session,
  { session, prompts: prompts.map(t), compactions: compactions.map(t), signals: signals.map((s) => ({ untrusted: false, ...s })) },
];

describe('findMisses', () => {
  it('a unit loaded before a compaction is out of context after it unless loaded again, while a predicted load stays', async () => {
    const { scan, load, timeline } = await setup();
    const agents = { ...load(CLAUDE, 0), observed: false, reason: 'session_start' };
    // DB loaded before the compaction at 10 and was summarised away; API loaded again just after it.
    const m = findMisses(
      [timeline('s1', 0, [agents, load(DB, 3), load(API, 4), load(API, 10)])],
      // The compaction at 20 comes after the interrupt, so it changes nothing.
      new Map([said('s1', [1, 12], [{ kind: 'interrupted', ts: t(15) }], [10, 20])]),
      scan,
      { minSessions: 3 },
    );

    expect(m.units.map((u) => u.id)).toEqual([API, CLAUDE]);
  });

  it('a correction is joined to every unit loaded before it, and inTurn counts it only for those loaded in its own turn', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses(
      // DB loaded two turns earlier and stays in context; the CLAUDE.md load comes after the correction.
      [timeline('s1', 0, [load(DB, 3), load(API, 12), load(CLAUDE, 16)])],
      // The interrupt's turn, from 18, loaded nothing new, yet three units were in context.
      new Map([said('s1', [1, 10, 15, 18], [{ kind: 'correction', ts: t(15), words: 'no, the other endpoint' }, { kind: 'interrupted', ts: t(20) }])]),
      scan,
      { minSessions: 3 },
    );

    expect(m.units.map((u) => [u.id, u.inTurn])).toEqual([
      [API, 1],
      [DB, 0],
      [CLAUDE, 0],
    ]);
    expect(m.units[0]!.signals).toEqual([
      { session: 's1', kind: 'correction', ts: t(15), untrusted: false, words: 'no, the other endpoint', context: [API, DB], turn: [API] },
      { session: 's1', kind: 'interrupted', ts: t(20), untrusted: false, context: [CLAUDE, API, DB], turn: [] },
    ]);
    expect(m.unattributed).toBe(0);
  });

  it('loads before the first prompt belong to the first turn', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses([timeline('s1', 0, [load(CLAUDE, 0)])], new Map([said('s1', [1], [{ kind: 'interrupted', ts: t(2) }])]), scan, { minSessions: 3 });

    expect(m.units.map((u) => [u.id, u.kinds])).toEqual([[CLAUDE, { interrupted: 1, correction: 0 }]]);
  });

  it('a unit reached in three sessions is routed, and in two it is not; two signals in one session count once', async () => {
    const { scan, load, timeline } = await setup();
    const sessions = ['s1', 's2', 's3'];
    const timelines = sessions.map((s) => timeline(s, 0, [load(API, 2)]));
    const transcripts = new Map(sessions.map((s) => said(s, [1], [{ kind: 'interrupted', ts: t(3) }, { kind: 'interrupted', ts: t(4) }])));

    const three = findMisses(timelines, transcripts, scan, { minSessions: 3 }).units[0]!;
    expect(three).toMatchObject({ id: API, sessions: 3, kinds: { interrupted: 6, correction: 0 }, first: t(3), last: t(4), routed: true });
    expect(findMisses(timelines.slice(1), transcripts, scan, { minSessions: 3 }).units[0]).toMatchObject({ sessions: 2, routed: false });
  });

  it('a session whose signals came after a web or MCP tool counts half', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses(
      [timeline('s1', 0, [load(API, 2)]), timeline('s2', 0, [load(API, 2)])],
            // s2 was stopped once before it read the web, so it counts in full.
      new Map([said('s1', [1], [{ kind: 'interrupted', ts: t(3), untrusted: true }]), said('s2', [1], [{ kind: 'interrupted', ts: t(3) }, { kind: 'interrupted', ts: t(4), untrusted: true }])]),
      scan,
      { minSessions: 3 },
    );

    expect(m.units[0]!.sessions).toBe(1.5);
    expect(m.units[0]!.halved).toBe(1);
    expect(m.untrusted).toBe(2);
  });

  it('a unit loaded in every session is marked everySession, and a session that loaded other bytes counts in olderVersion', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses(
      // s3 loaded other bytes too, but had no signal.
      [timeline('s1', 0, [load(CLAUDE, 0, true), load(API, 2)]), timeline('s2', 0, [load(CLAUDE, 0)]), timeline('s3', 0, [load(CLAUDE, 0, true)])],
      new Map([said('s1', [1], [{ kind: 'interrupted', ts: t(3) }]), said('s2', [1], [{ kind: 'interrupted', ts: t(3) }])]),
      scan,
      { minSessions: 3 },
    );

    expect(m.units.map((u) => [u.id, u.loadedIn, u.everySession, u.olderVersion])).toEqual([
      [CLAUDE, 3, true, 1],
      [API, 1, false, 0],
    ]);
  });

  it('a synced unit names its upstream from the lock, and owners come from ctxlock.yaml or CODEOWNERS', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses(
      [timeline('s1', 0, [load(API, 2), load(DB, 2), load(TEST, 2)])],
      new Map([said('s1', [1], [{ kind: 'interrupted', ts: t(3) }])]),
      scan,
      { minSessions: 3 },
    );

    expect(m.units.map((u) => [u.id, u.owners, u.upstream])).toEqual([
      [API, ['@api-team'], null],
      [DB, ['@db-team'], null],
      [TEST, [], { name: 'platform', repo: 'https://github.com/acme/context.git' }],
    ]);
  });

  it('a session with no transcript, and a signal before any load, are counted and attributed to no unit', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses(
      [timeline('s1', 0, [load(API, 9)]), timeline('s2', 0, [load(API, 2)]), timeline('s3', 0, [load(API, 2)])],
      new Map([said('s1', [1, 5], [{ kind: 'correction', ts: t(8) }]), said('s3', [1], [])]),
      scan,
      { minSessions: 3 },
    );

    expect(m).toMatchObject({ sessions: 3, withTranscript: 2, withSignal: 1, signals: { interrupted: 0, correction: 1 }, unattributed: 1, units: [] });
  });

  it('a signal before the collector recorded its session is counted apart: what was in context then is unknown', async () => {
    const { scan, load, timeline } = await setup();
    const m = findMisses([timeline('s1', 10, [load(API, 10)])], new Map([said('s1', [1, 5, 12], [{ kind: 'correction', ts: t(5) }, { kind: 'interrupted', ts: t(13) }])]), scan, { minSessions: 3 });

    expect(m).toMatchObject({ unrecorded: 1, unattributed: 0, signals: { interrupted: 1, correction: 1 } });
    // Every signal is listed, joined or not.
    expect(m.found.map((s) => [s.kind, s.ts, s.unrecorded ?? false, s.context])).toEqual([
      ['correction', t(5), true, []],
      ['interrupted', t(13), false, [API]],
    ]);
    expect(m.units.map((u) => [u.id, u.kinds])).toEqual([[API, { interrupted: 1, correction: 0 }]]);
  });

  it('since is a date where the person is, not in UTC', async () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    try {
      const { scan, load, timeline } = await setup();
      // 00:30 on 10 November in Kolkata is 19:00 on 9 November in UTC; 23:30 on the 9th is still the 9th.
      const justAfter = { ...timeline('s1', 0, [load(API, 2)]), begun: new Date(2026, 10, 10, 0, 30).toISOString() };
      const justBefore = { ...timeline('s2', 0, [load(API, 2)]), begun: new Date(2026, 10, 9, 23, 30).toISOString() };

      expect(findMisses([justAfter, justBefore], new Map(), scan, { minSessions: 3, since: '2026-11-10' }).sessions).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('since leaves out sessions begun before it', async () => {
    const { scan, load, timeline } = await setup();
    const early = { ...timeline('s1', 0, [load(API, 2)]), begun: '2026-11-09T10:00:00.000Z' };
    const m = findMisses([early, timeline('s2', 0, [load(API, 2)])], new Map([said('s1', [1], [{ kind: 'interrupted', ts: t(3) }])]), scan, { minSessions: 3, since: '2026-11-10' });

    expect(m).toMatchObject({ sessions: 1, since: '2026-11-10', withSignal: 0, units: [] });
  });
});
