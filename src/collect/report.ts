import type { ScanResult } from '../scan.js';
import type { Sessions } from './sessions.js';

// What a repository's sessions loaded, to share with the org: no session ID, no path outside the
// repository, and no error message, which can carry one (D74).
export interface Report {
  version: 1;
  repo: string;
  harness: 'claude-code';
  from: string | null;
  to: string | null;
  sessions: number;
  units: Array<{ id: string; digest: string; sessions: number; lastSeen: string; predicted: boolean }>;
  collectorErrors: number;
}

const NETWORK = new Set(['http:', 'https:', 'ssh:', 'git:']);
// git's scp-like form, as in git@github.com:acme/web.git.
const SCP = /^[\w.-]+@[\w.-]+:/;

// What the report may say of the repository: a network URL without the user, password, query or
// fragment it can carry a token in; for a local origin, only the folder's name.
export function shareable(repo: string): string {
  if (SCP.test(repo)) return repo;
  if (URL.canParse(repo) && NETWORK.has(new URL(repo).protocol)) {
    const url = new URL(repo);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  }
  return repo.split(/[\\/]/).filter(Boolean).at(-1) ?? repo;
}

export function buildReport(s: Sessions, scan: ScanResult, repo: string): Report {
  const digests = new Map(scan.units.map((u) => [u.id, u.digest]));
  return {
    version: 1,
    repo: shareable(repo),
    harness: 'claude-code',
    from: s.first,
    to: s.last,
    sessions: s.sessions,
    // joinSessions reports only units the scan has, so each has its digest now.
    units: s.units.map((u) => ({ id: u.id, digest: digests.get(u.id)!, sessions: u.sessions, lastSeen: u.lastSeen, predicted: u.predicted })),
    collectorErrors: s.errors.count,
  };
}
