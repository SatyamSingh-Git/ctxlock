import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RecordedEvent } from '../../src/collect/events.js';
import { joinSessions, sessionTimelines } from '../../src/collect/sessions.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';

const ROOT = resolve('/work/repo');
const at = (path: string) => join(ROOT, path);
const sha = (text: string) => lfDigest(Buffer.from(text));
const t = (minute: number) => `2026-11-08T10:${String(minute).padStart(2, '0')}:00.000Z`;

const start = (session: string, ts: string, cwd = ROOT): RecordedEvent => ({ event: 'session_start', ts, session, cwd, source: 'startup' });
const load = (session: string, ts: string, file: string, reason: string, sha256: string | null, cwd = ROOT): RecordedEvent => ({
  event: 'load', ts, session, cwd, file, sha256, reason,
});
const skill = (session: string, ts: string, name: string, cwd = ROOT): RecordedEvent => ({ event: 'skill', ts, session, cwd, skill: name });

const join_ = async (files: Record<string, string>, events: RecordedEvent[], skipped = 0) => joinSessions({ events, skipped }, await scanRepo(memReader(files)), [ROOT]);

const RULE = '---\npaths: ["packages/api/**"]\n---\nAPI rule\n';

describe('joinSessions', () => {
  it('counts each unit once per session, with its reasons and its last load', async () => {
    const files = { 'CLAUDE.md': 'c\n', '.claude/rules/api.md': RULE, 'packages/api/h.ts': 'x' };
    // Hooks run asynchronously, so a session's lines are not in time order.
    const s = await join_(files, [
      start('s2', t(5)),
      load('s2', t(5), at('CLAUDE.md'), 'session_start', sha('c\n')),
      load('s1', t(4), at('CLAUDE.md'), 'compact', sha('c\n')),
      load('s1', t(3), at('.claude/rules/api.md'), 'path_glob_match', sha(RULE)),
      load('s1', t(1), at('CLAUDE.md'), 'session_start', sha('c\n')),
      start('s1', t(1)),
    ]);

    expect(s).toMatchObject({ sessions: 2, first: t(1), last: t(5) });
    expect(s.units).toEqual([
      { id: 'instructions/CLAUDE.md', path: 'CLAUDE.md', sessions: 2, reasons: ['compact', 'session_start'], lastSeen: t(5), otherVersion: 0, predicted: false },
      { id: 'rule/.claude/rules/api.md', path: '.claude/rules/api.md', sessions: 1, reasons: ['glob'], lastSeen: t(3), otherVersion: 0, predicted: false },
    ]);
  });

  it('matches a skill call to the skill Claude Code lists, by name; an unknown name is ignored', async () => {
    const s = await join_(
      {
        'CLAUDE.md': 'c\n',
        '.claude/skills/release/SKILL.md': '---\nname: release\ndescription: Publish a version.\n---\nSteps.\n',
        // Below the top, so not listed when a session starts there.
        'pkg/.claude/skills/simplify/SKILL.md': '---\nname: simplify\ndescription: A nested skill.\n---\nx\n',
      },
      [start('s1', t(1)), skill('s1', t(2), 'release'), skill('s1', t(3), 'simplify'), skill('s1', t(4), 'unknown')],
    );

    expect(s.units).toEqual([
      { id: 'skill/.claude/skills/release', path: '.claude/skills/release', sessions: 1, reasons: ['skill_invoked'], lastSeen: t(2), otherVersion: 0, predicted: false },
    ]);
  });

  it('credits a skill call to a skill Claude Code offers in the folder the session started in', async () => {
    const files = {
      'CLAUDE.md': 'c\n',
      'pkg/.claude/skills/simplify/SKILL.md': '---\nname: simplify\ndescription: A package skill.\n---\nx\n',
      'pkg/.claude/skills/other/SKILL.md': '---\nname: other\ndescription: Another package skill.\n---\nx\n',
    };

    const inPkg = await join_(files, [start('s1', t(1), at('pkg')), skill('s1', t(2), 'simplify', at('pkg'))]);
    expect(inPkg.units.map((u) => [u.path, u.reasons])).toEqual([['pkg/.claude/skills/simplify', ['skill_invoked']]]);
    expect(inPkg.unseen).toEqual([
      { id: 'instructions/CLAUDE.md', path: 'CLAUDE.md', mode: 'always' },
      { id: 'skill/pkg/.claude/skills/other', path: 'pkg/.claude/skills/other', mode: 'listed' },
    ]);

    // At the top it is not offered, and a call by that name can be Claude Code's built-in skill.
    const atTop = await join_(files, [start('s1', t(1)), skill('s1', t(2), 'simplify')]);
    expect(atTop.units).toEqual([]);
    expect(atTop.unseen.map((u) => u.path)).toEqual(['CLAUDE.md']);
  });

  it('predicts the AGENTS.md fallback from the folder a session started in', async () => {
    const files = { 'AGENTS.md': 'Use pnpm.\n', 'pkg/CLAUDE.md': 'pkg\n' };

    // Started below pkg, which holds the nearest CLAUDE.md.
    const src = at('pkg/src');
    const inPkg = await join_(files, [start('s1', t(1), src), load('s1', t(1), at('pkg/CLAUDE.md'), 'session_start', sha('pkg\n'), src)]);
    expect(inPkg.units.map((u) => [u.path, u.predicted])).toEqual([['pkg/CLAUDE.md', false]]);
    expect(inPkg.unseen).toEqual([]);

    const atTop = await join_(files, [start('s1', t(1))]);
    expect(atTop.units.map((u) => [u.path, u.predicted])).toEqual([['AGENTS.md', true]]);
  });

  it('leaves out of what was not loaded an AGENTS.md below the top, which Claude Code reads without saying so', async () => {
    const s = await join_({ 'AGENTS.md': 'Use pnpm.\n', 'packages/web/AGENTS.md': 'web\n' }, [start('s1', t(1))]);

    expect(s.units.map((u) => u.path)).toEqual(['AGENTS.md']);
    expect(s.unseen).toEqual([]);
  });

  it('leaves out files outside the repository, but counts a session started in a subfolder', async () => {
    const files = { 'CLAUDE.md': 'c\n', 'packages/api/CLAUDE.md': 'api\n' };
    const sub = at('packages/api');
    const s = await join_(files, [
      load('s1', t(1), resolve('/home/u/.claude/CLAUDE.md'), 'session_start', sha('mine\n'), sub),
      load('s1', t(1), at('CLAUDE.md'), 'session_start', sha('c\n'), sub),
      load('s1', t(1), at('packages/api/CLAUDE.md'), 'session_start', sha('api\n'), sub),
      load('s2', t(2), resolve('/work/other/CLAUDE.md'), 'session_start', sha('c\n'), resolve('/work/other')),
      // A sibling whose name starts with the repository's.
      load('s3', t(3), resolve('/work/repo-two/CLAUDE.md'), 'session_start', sha('c\n'), resolve('/work/repo-two')),
      // Started above the repository: it counts only when it loaded something inside.
      load('s4', t(4), resolve('/work/CLAUDE.md'), 'session_start', sha('w\n'), resolve('/work')),
      load('s5', t(5), at('packages/api/CLAUDE.md'), 'nested_traversal', sha('api\n'), resolve('/work')),
    ]);

    expect(s.sessions).toBe(2);
    expect(s.elsewhere).toBe(3);
    expect(s.units.map((u) => [u.path, u.sessions])).toEqual([
      ['packages/api/CLAUDE.md', 2],
      ['CLAUDE.md', 1],
    ]);
  });

  it.runIf(process.platform === 'win32')('matches paths whatever their separators or drive-letter case', async () => {
    const other = (path: string) => (path[0]!.toLowerCase() + path.slice(1)).replaceAll('\\', '/');
    const s = await join_({ 'CLAUDE.md': 'c\n' }, [
      load('s1', t(1), other(at('CLAUDE.md')), 'session_start', sha('c\n'), other(ROOT)),
      start('s2', t(2), String.raw`Z:\elsewhere`),
    ]);

    expect(s.sessions).toBe(1);
    expect(s.units.map((u) => u.path)).toEqual(['CLAUDE.md']);
  });

  it('matches a path recorded under another name for the folder, or in another case below the top, by its real path', async () => {
    // As a junction or an 8.3 name would read, and a path the agent typed in another case.
    const alias = resolve('/alias/repo');
    const real = (path: string) => (path.startsWith(alias) ? ROOT + path.slice(alias.length) : path).replace('PACKAGES', 'packages');
    const events = [
      start('s1', t(1), alias),
      load('s1', t(1), join(alias, 'CLAUDE.md'), 'session_start', sha('c\n'), alias),
      load('s1', t(2), join(alias, 'PACKAGES', 'api', 'CLAUDE.md'), 'nested_traversal', sha('api\n'), alias),
      // Started elsewhere, and inside only by the real path of what it loaded.
      load('s2', t(3), join(alias, 'CLAUDE.md'), 'session_start', sha('c\n'), resolve('/elsewhere')),
    ];
    const scan = await scanRepo(memReader({ 'CLAUDE.md': 'c\n', 'packages/api/CLAUDE.md': 'api\n' }));

    const s = joinSessions({ events, skipped: 0 }, scan, [ROOT], real);
    expect(s.sessions).toBe(2);
    expect(s.units.map((u) => u.path)).toEqual(['CLAUDE.md', 'packages/api/CLAUDE.md']);
    expect(joinSessions({ events, skipped: 0 }, scan, [ROOT]).sessions).toBe(0);
  });

  it('judges a session by the real path of the folder it started in', async () => {
    const real = (path: string) => path.replace('PKG', 'pkg');
    const scan = await scanRepo(memReader({ 'AGENTS.md': 'Use pnpm.\n', 'pkg/CLAUDE.md': 'pkg\n' }));

    // pkg has a CLAUDE.md of its own, so Claude Code reads no AGENTS.md through its fallback there.
    expect(joinSessions({ events: [start('s1', t(1), at('PKG'))], skipped: 0 }, scan, [ROOT], real).units).toEqual([]);
  });

  it('counts a load of an edited file as another version of the unit', async () => {
    const s = await join_({ 'CLAUDE.md': 'now\n' }, [
      load('s1', t(1), at('CLAUDE.md'), 'session_start', sha('then\n')),
      load('s1', t(1), at('CLAUDE.md'), 'compact', sha('then\n')),
      load('s2', t(2), at('CLAUDE.md'), 'session_start', sha('now\n')),
      load('s3', t(3), at('CLAUDE.md'), 'session_start', null),
    ]);

    expect(s.units).toEqual([expect.objectContaining({ path: 'CLAUDE.md', sessions: 3, otherVersion: 1 })]);
  });

  it('labels AGENTS.md read through the fallback as predicted, in every session', async () => {
    const files = { 'AGENTS.md': 'Use pnpm.\n@sub/AGENTS.md\n', 'sub/AGENTS.md': 'sub\n' };
    // S5: a session's loads arrive before its SessionStart.
    const s = await join_(files, [start('s1', t(1)), load('s2', t(6), at('sub/AGENTS.md'), 'include', sha('sub\n')), start('s2', t(5))]);

    expect(s.units).toEqual([
      { id: 'instructions/AGENTS.md', path: 'AGENTS.md', sessions: 2, reasons: ['session_start'], lastSeen: t(5), otherVersion: 0, predicted: true },
      { id: 'instructions/sub/AGENTS.md', path: 'sub/AGENTS.md', sessions: 2, reasons: ['import'], lastSeen: t(6), otherVersion: 0, predicted: false },
    ]);

    // Once Claude Code reports it, nothing is predicted for it.
    const seen = await join_(files, [start('s1', t(1)), load('s1', t(2), at('AGENTS.md'), 'compact', sha('Use pnpm.\n@sub/AGENTS.md\n'))]);
    expect(seen.units.find((u) => u.path === 'AGENTS.md')).toMatchObject({ reasons: ['compact'], predicted: false });
  });

  it('lists what Claude Code can load that no session loaded, with its mode, and nothing before any session', async () => {
    const files = {
      'CLAUDE.md': 'c\n@docs/notes.md\n',
      'docs/notes.md': 'not a unit\n',
      '.claude/rules/style.md': 'Two spaces.\n',
      '.claude/rules/api.md': RULE,
      '.claude/skills/old/SKILL.md': '---\nname: old\ndescription: Unused.\n---\nx\n',
    };

    expect((await join_(files, [start('s1', t(1)), load('s1', t(1), at('CLAUDE.md'), 'session_start', sha('c\n@docs/notes.md\n'))])).unseen).toEqual([
      { id: 'rule/.claude/rules/api.md', path: '.claude/rules/api.md', mode: 'lazy' },
      { id: 'rule/.claude/rules/style.md', path: '.claude/rules/style.md', mode: 'always' },
      { id: 'skill/.claude/skills/old', path: '.claude/skills/old', mode: 'listed' },
    ]);
    expect((await join_(files, [])).unseen).toEqual([]);
  });

  it('counts collector errors and unread lines, whatever the repository', async () => {
    const s = await join_(
      { 'CLAUDE.md': 'c\n' },
      // Writers can interleave, so the latest error is not always the last line.
      [{ event: 'error', ts: t(3), message: 'EACCES' }, start('s9', t(2), resolve('/elsewhere')), { event: 'error', ts: t(1), message: 'disk full' }],
      2,
    );

    expect(s).toMatchObject({ sessions: 0, first: null, last: null, units: [], errors: { count: 2, last: { ts: t(3), message: 'EACCES' } }, skipped: 2 });
    expect((await join_({ 'CLAUDE.md': 'c\n' }, [])).errors).toEqual({ count: 0 });
  });

  it('says when no consumer covers the sessions', async () => {
    const seen = [start('s1', t(1))];
    const yaml = (body: string) => ({ 'CLAUDE.md': 'c\n', 'ctxlock.yaml': `version: 1\n${body}` });

    expect((await join_(yaml(''), seen)).undeclared).toBe(true);
    expect((await join_(yaml('consumers:\n  api:\n    harnesses: [codex]\n'), seen)).undeclared).toBe(true);
    expect((await join_(yaml('consumers:\n  web:\n    harnesses: [claude-code]\n'), seen)).undeclared).toBe(false);
    expect((await join_(yaml(''), [])).undeclared).toBe(false);
  });
});

describe('joinSessions, its dates', () => {
  it("ends at a session's last event, not at its start", async () => {
    const s = await join_({ 'CLAUDE.md': 'c\n' }, [start('s1', t(1)), load('s1', t(9), at('CLAUDE.md'), 'compact', sha('c\n'))]);

    expect(s).toMatchObject({ first: t(1), last: t(9) });
  });
});

describe('sessionTimelines', () => {
  it('gives each session in the repository its folder, first and last times, and its loads in time order, including predicted fallback loads; a session elsewhere is left out', async () => {
    const files = { 'AGENTS.md': 'Use pnpm.\n', '.claude/rules/api.md': RULE, 'packages/api/h.ts': 'x' };
    const scan = await scanRepo(memReader(files));
    const timelines = sessionTimelines(
      {
        events: [
          load('s1', t(3), at('.claude/rules/api.md'), 'path_glob_match', sha('older\n'), at('packages/api')),
          start('s1', t(1), at('packages/api')),
          start('far', t(2), resolve('/elsewhere')),
        ],
        skipped: 0,
      },
      scan,
      [ROOT],
    );

    expect(timelines.map(({ session, folder, begun, last }) => ({ session, folder, begun, last }))).toEqual([{ session: 's1', folder: 'packages/api', begun: t(1), last: t(3) }]);
    expect(timelines[0]!.loads.map((l) => ({ id: l.unit.id, ts: l.ts, reason: l.reason, other: l.other, observed: l.observed }))).toEqual([
      { id: 'instructions/AGENTS.md', ts: t(1), reason: 'session_start', other: false, observed: false },
      { id: 'rule/.claude/rules/api.md', ts: t(3), reason: 'glob', other: true, observed: true },
    ]);
  });
});
