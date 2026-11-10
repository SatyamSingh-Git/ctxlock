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

// An origin URL can carry a token, as https://user:token@host/org/repo does.
function withoutCredentials(repo: string): string {
  if (!URL.canParse(repo)) return repo;
  const url = new URL(repo);
  if (url.username === '' && url.password === '') return repo;
  url.username = '';
  url.password = '';
  return url.href;
}

export function buildReport(s: Sessions, scan: ScanResult, repo: string): Report {
  const digests = new Map(scan.units.map((u) => [u.id, u.digest]));
  return {
    version: 1,
    repo: withoutCredentials(repo),
    harness: 'claude-code',
    from: s.first,
    to: s.last,
    sessions: s.sessions,
    // joinSessions reports only units the scan has, so each has its digest now.
    units: s.units.map((u) => ({ id: u.id, digest: digests.get(u.id)!, sessions: u.sessions, lastSeen: u.lastSeen, predicted: u.predicted })),
    collectorErrors: s.errors.count,
  };
}
