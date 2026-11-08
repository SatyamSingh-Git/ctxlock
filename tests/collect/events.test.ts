import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { eventsHome, readEvents } from '../../src/collect/events.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

const line = (o: object) => JSON.stringify({ v: 1, harness: 'claude-code', ...o });

describe('readEvents', () => {
  it("reads every month's file, and skips lines it cannot read", () => {
    const home = tempDir();
    mkdirSync(join(home, 'events'));
    writeFileSync(
      join(home, 'events', '2026-11.jsonl'),
      [
        line({ ts: '2026-11-01T00:00:00.000Z', session: 's1', cwd: '/r', event: 'load', file: '/r/CLAUDE.md', sha256: 'ab', reason: 'session_start', trigger: '/r/a.ts' }),
        line({ ts: '2026-11-01T00:00:01.000Z', session: 's1', cwd: '/r', event: 'load', file: '/r/gone.md', sha256: null, reason: 'include', parent: '/r/CLAUDE.md' }),
        line({ ts: '2026-11-01T00:00:02.000Z', session: 's1', cwd: '/r', event: 'skill', skill: 'release' }),
        JSON.stringify({ v: 1, ts: '2026-11-01T00:00:03.000Z', event: 'error', message: 'disk full {"v":1}' }),
        JSON.stringify({ v: 2, ts: '2026-11-01T00:00:04.000Z', session: 's1', cwd: '/r', event: 'session_start' }),
        line({ ts: '2026-11-01T00:00:05.000Z', session: 's1', cwd: '/r', event: 'compact' }),
        '',
      ].join('\n'),
    );
    // Written by two sessions at once, one line cut short.
    writeFileSync(
      join(home, 'events', '2026-10.jsonl'),
      line({ ts: '2026-10-31T23:59:00.000Z', session: 's0', cwd: '/r', event: 'session_start', source: 'startup' }) + '\n{"v":1,"ts":"2026-10-31T23:59:01.000Z","sess\n',
    );
    writeFileSync(join(home, 'events', 'notes.txt'), 'not events\n');

    expect(readEvents(home)).toEqual({
      events: [
        { event: 'session_start', ts: '2026-10-31T23:59:00.000Z', session: 's0', cwd: '/r', source: 'startup' },
        { event: 'load', ts: '2026-11-01T00:00:00.000Z', session: 's1', cwd: '/r', file: '/r/CLAUDE.md', sha256: 'ab', reason: 'session_start', trigger: '/r/a.ts' },
        { event: 'load', ts: '2026-11-01T00:00:01.000Z', session: 's1', cwd: '/r', file: '/r/gone.md', sha256: null, reason: 'include', parent: '/r/CLAUDE.md' },
        { event: 'skill', ts: '2026-11-01T00:00:02.000Z', session: 's1', cwd: '/r', skill: 'release' },
        { event: 'error', ts: '2026-11-01T00:00:03.000Z', message: 'disk full {"v":1}' },
      ],
      skipped: 3,
    });
  });

  it('reads a whole line written after one cut short without its newline', () => {
    const home = tempDir();
    mkdirSync(join(home, 'events'));
    const whole = line({ ts: '2026-11-01T00:00:01.000Z', session: 's1', cwd: '/r', event: 'skill', skill: 'release' });
    writeFileSync(join(home, 'events', '2026-11.jsonl'), `{"v":1,"ts":"2026-11-01T00:00:00.000Z","sess${whole}\n`);

    expect(readEvents(home)).toEqual({ events: [{ event: 'skill', ts: '2026-11-01T00:00:01.000Z', session: 's1', cwd: '/r', skill: 'release' }], skipped: 1 });
  });

  it('no events folder gives no events', () => {
    expect(readEvents(tempDir())).toEqual({ events: [], skipped: 0 });
  });

  it('an events path that is a file gives no events', () => {
    const home = tempDir();
    writeFileSync(join(home, 'events'), 'not a folder\n');
    expect(readEvents(home)).toEqual({ events: [], skipped: 0 });
  });

  it('eventsHome is CTXLOCK_HOME, else .ctxlock in the home folder', () => {
    expect(eventsHome({ CTXLOCK_HOME: join('x', 'y') })).toBe(join('x', 'y'));
    expect(eventsHome({})).toBe(join(homedir(), '.ctxlock'));
    // As the collector reads it.
    expect(eventsHome({ CTXLOCK_HOME: '' })).toBe(join(homedir(), '.ctxlock'));
  });
});
