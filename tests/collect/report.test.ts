import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/collect/report.js';
import { joinSessions } from '../../src/collect/sessions.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { memReader } from '../helpers/mem-reader.js';

const ROOT = resolve('/work/secret-folder/repo');
const t = (minute: number) => `2026-11-08T10:${String(minute).padStart(2, '0')}:00.000Z`;
const FILES = { 'CLAUDE.md': 'c\n', 'AGENTS.md': 'a\n', '.claude/rules/api.md': 'API rule\n' };

async function report(repo: string) {
  const scan = await scanRepo(memReader(FILES));
  const s = joinSessions(
    {
      events: [
        { event: 'session_start', ts: t(1), session: 'session-id-1', cwd: ROOT },
        { event: 'load', ts: t(1), session: 'session-id-1', cwd: ROOT, file: join(ROOT, 'CLAUDE.md'), sha256: lfDigest(Buffer.from('c\n')), reason: 'session_start' },
        { event: 'load', ts: t(3), session: 'session-id-2', cwd: ROOT, file: join(ROOT, '.claude/rules/api.md'), sha256: null, reason: 'session_start' },
        { event: 'error', ts: t(4), message: `cannot read ${join(ROOT, 'x')}` },
      ],
      skipped: 0,
    },
    scan,
    [ROOT],
  );
  return { scan, report: buildReport(s, scan, repo) };
}

describe('buildReport', () => {
  it("has the loads a repository's sessions made, each unit with its digest now, and these keys only", async () => {
    const { scan, report: r } = await report('https://github.com/acme/payments.git');
    const digest = (path: string) => scan.units.find((u) => u.path === path)!.digest;

    expect(r).toEqual({
      version: 1,
      repo: 'https://github.com/acme/payments.git',
      harness: 'claude-code',
      from: t(1),
      to: t(3),
      sessions: 2,
      units: [
        { id: 'rule/.claude/rules/api.md', digest: digest('.claude/rules/api.md'), sessions: 1, lastSeen: t(3), predicted: false },
        { id: 'instructions/CLAUDE.md', digest: digest('CLAUDE.md'), sessions: 1, lastSeen: t(1), predicted: false },
      ],
      collectorErrors: 1,
    });
  });

  it('holds no session ID, local path or error message, and no credentials from the origin URL', async () => {
    const { report: r } = await report('https://user:token@github.com/acme/payments.git');
    const text = JSON.stringify(r);

    expect(r.repo).toBe('https://github.com/acme/payments.git');
    for (const local of ['session-id', 'secret-folder', 'cannot read', 'token', 'user']) expect(text).not.toContain(local);
  });

  it('names a repository whose origin is a local path by its folder, and drops a query from a URL', async () => {
    for (const origin of ['/home/satyam/src/acme-web', 'C:\\Users\\satyam\\src\\acme-web', 'file:///home/satyam/src/acme-web/', '../acme-web']) {
      expect((await report(origin)).report.repo).toBe('acme-web');
    }
    expect((await report('https://github.com/acme/web.git?access_token=abc#x')).report.repo).toBe('https://github.com/acme/web.git');
    expect((await report('git@github.com:acme/web.git')).report.repo).toBe('git@github.com:acme/web.git');
  });
});
