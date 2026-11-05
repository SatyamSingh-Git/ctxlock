import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const created: string[] = [];

// Windows allows symlinks only with developer mode or admin rights; tests that need real links skip without them.
export const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'ctxlock-link-'));
  try {
    symlinkSync('target', join(dir, 'link'));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxlock-'));
  created.push(dir);
  return dir;
}

export function cleanup(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

// A null value deletes the file.
export function writeTree(dir: string, files: Record<string, string | Buffer | null>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    if (content === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export async function gitRepo(
  commits: Array<Record<string, string | Buffer | null>>,
): Promise<{ dir: string; shas: string[] }> {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'core.autocrlf', 'false');
  const shas: string[] = [];
  commits.forEach((files, i) => {
    writeTree(dir, files);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--allow-empty', '-m', `commit ${i}`);
    shas.push(git(dir, 'rev-parse', 'HEAD'));
  });
  return { dir, shas };
}

// Commits a symlink through the index so it works on Windows without developer mode.
// The working tree is left without the link; read it back through gitReader.
export function gitSymlink(dir: string, path: string, target: string): string {
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: target, encoding: 'utf8' }).trim();
  git(dir, 'update-index', '--add', '--cacheinfo', `120000,${blob},${path}`);
  git(dir, 'commit', '-q', '-m', `link ${path}`);
  return git(dir, 'rev-parse', 'HEAD');
}
