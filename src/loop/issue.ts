import { spawnSync } from 'node:child_process';

export class IssueError extends Error {}

const GITHUB = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

// owner/name, from any form of a GitHub URL; null for anything else.
export const githubRepo = (repo: string) => GITHUB.exec(repo)?.[1] ?? null;

// gh runs as given, with no shell between, and the body goes on stdin, so no text in it is ever a command
// line. A .js stand-in runs under node, as claude's does.
function gh(cmd: string[], args: string[], repo: string, input?: string): string {
  const [exe, ...pre] = /\.[cm]?js$/.test(cmd[0]!) ? [process.execPath, ...cmd] : cmd;
  const r = spawnSync(exe!, [...pre, ...args], { encoding: 'utf8', ...(input !== undefined && { input }) });
  if (r.error) throw new IssueError(`gh ${args.slice(0, 2).join(' ')} could not run for ${repo}: ${r.error.message}`);
  if (r.status !== 0) throw new IssueError(`gh ${args.slice(0, 2).join(' ')} failed for ${repo}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  return r.stdout;
}

// One issue per unit (D87): the issue whose body starts with the marker is updated; otherwise one is filed.
// GitHub's search index lags behind new issues, so when search finds none, the latest issues are read too.
// A closed one is reopened: the unit missed again after it was closed, and an edit alone notifies no one.
export async function openIssue(repo: string, title: string, body: string, marker: string, cmd: string[] = ['gh']): Promise<{ number: number; url: string; created: boolean; reopened: boolean }> {
  const find = (filter: string[], limit: string) => {
    const listed = gh(cmd, ['issue', 'list', '-R', repo, '--state', 'all', ...filter, '--json', 'number,url,body,state', '--limit', limit], repo);
    return (JSON.parse(listed || '[]') as Array<{ number: number; url: string; body: string; state: string }>).find((i) => i.body.startsWith(marker));
  };
  const found = find(['--search', `"${marker.trim()}" in:body`], '20') ?? find([], '100');
  if (found) {
    gh(cmd, ['issue', 'edit', String(found.number), '-R', repo, '--body-file', '-'], repo, body);
    const reopened = found.state === 'CLOSED';
    if (reopened) gh(cmd, ['issue', 'reopen', String(found.number), '-R', repo], repo);
    return { number: found.number, url: found.url, created: false, reopened };
  }
  const url = gh(cmd, ['issue', 'create', '-R', repo, '--title', title, '--body-file', '-'], repo, body).trim().split('\n').at(-1)!;
  return { number: Number(/\/issues\/(\d+)$/.exec(url)?.[1]), url, created: true, reopened: false };
}
