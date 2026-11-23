import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Upstream } from '../registry/registry.js';
import { type RepoReader, gitReader } from '../repo/reader.js';

const run = promisify(execFile);

export class UpstreamError extends Error {}

// git's own complaint, first line, for the message.
const said = (err: unknown) => String((err as { stderr?: string }).stderr ?? '').trim().split('\n')[0] || (err as Error).message;

// Clones once into ctxlock's cache and fetches after that, then reads the upstream at the commit its
// ref resolves to. The clone has no checkout, and is read only through gitReader.
export async function fetchUpstream(u: Upstream, cache: string, { credentials = true } = {}): Promise<{ commit: string; reader: RepoReader }> {
  const root = join(cache, 'upstream');
  const noHooks = join(root, 'no-hooks');
  mkdirSync(noHooks, { recursive: true });
  const dir = join(root, createHash('sha256').update(u.repo).digest('hex').slice(0, 16));
  // Upstream content is data: no hook runs, the upstream's or one set in global config, and no ext:: transport.
  // Without credentials, for a stranger's URL, git asks no one for a password either: no terminal prompt,
  // askpass program or credential helper (a window, on Windows), so it fails at once instead of waiting.
  // Sync's upstreams are the repository owner's own, often private, so they keep the user's credentials.
  const locked = credentials ? [] : ['-c', 'credential.helper=', '-c', 'core.askPass='];
  const env = credentials ? process.env : { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' };
  const git = (args: string[]) => run('git', ['-c', `core.hooksPath=${noHooks}`, '-c', 'protocol.ext.allow=never', ...locked, ...args], { windowsHide: true, env });

  try {
    if (existsSync(dir)) await git(['-C', dir, 'fetch', '--quiet', '--prune', '--prune-tags', '--tags', '--force', 'origin']);
    else await git(['clone', '--no-checkout', '--quiet', '--', u.repo, dir]);
  } catch (err) {
    throw new UpstreamError(`upstream ${u.name}: cannot fetch ${u.repo}: ${said(err)}`);
  }

  // Only what was just fetched: the clone's own branches never move, so a branch deleted upstream would
  // still resolve, to where it was when the cache was made. A tag moved upstream is fetched with --force.
  const candidates = [`refs/remotes/origin/${u.ref}`, `refs/tags/${u.ref}`, ...(/^[0-9a-f]{4,40}$/.test(u.ref) ? [u.ref] : [])];
  for (const candidate of candidates) {
    let commit: string;
    try {
      commit = (await git(['-C', dir, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`])).stdout.trim();
    } catch {
      continue;
    }
    return { commit, reader: await gitReader(dir, commit) };
  }
  throw new UpstreamError(`upstream ${u.name}: no ref ${u.ref} in ${u.repo}`);
}
