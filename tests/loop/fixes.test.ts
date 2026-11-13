import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FixesError, shippedFixes } from '../../src/loop/fixes.js';
import { fsReader } from '../../src/repo/reader.js';
import { scanRepo } from '../../src/scan.js';
import { lfDigest } from '../../src/units/digest.js';
import { cleanup, git, tempDir, writeTree } from '../helpers/repo.js';

afterAll(cleanup);
afterEach(() => vi.unstubAllEnvs());

const ID = 'rule/.claude/rules/deps.md';
const RULE = '# Dependencies\n\nInstall packages with npm install.\n';
const FIXED = '# Dependencies\n\nInstall packages with pnpm add.\n';
const probe = (id: string, unit = ID, prompt = 'Add the dayjs package.') => `version: 1\nprobes:\n  - id: ${id}\n    unit: ${unit}\n    prompt: ${prompt}\n    expect:\n      command: pnpm add\n`;
const MISS = 'miss-rule-.claude-rules-deps.md-4d49356f';

// One commit per entry, each at its own committer date.
function history(commits: Array<{ at: string; files: Record<string, string | null> }>) {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'core.autocrlf', 'false');
  const shas = commits.map(({ at, files }, i) => {
    writeTree(dir, files);
    vi.stubEnv('GIT_COMMITTER_DATE', at);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--allow-empty', '-m', `commit ${i}`);
    return git(dir, 'rev-parse', 'HEAD');
  });
  return { dir, shas };
}

const run = async (dir: string) => shippedFixes(dir, await scanRepo(fsReader(dir)));
const digest = (text: string) => lfDigest(Buffer.from(text));

describe('shippedFixes', () => {
  it("a commit that adds a miss- probe ships its fix, at that commit's time, with the unit's bytes from then on", async () => {
    const LATER = `${FIXED}Keep the lockfile committed.\n`;
    const { dir, shas } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE } },
      { at: '2026-11-02T09:30:00-05:00', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } },
      { at: '2026-11-03T10:00:00+00:00', files: { '.claude/rules/deps.md': LATER } },
    ]);
    writeTree(dir, { '.claude/rules/deps.md': `${LATER}Uncommitted.\n` });

    const { fixes, orphans, git: inGit } = await run(dir);

    expect(inGit).toBe(true);
    expect(orphans).toEqual([]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ unit: ID, commit: shas[1], shippedAt: '2026-11-02T09:30:00-05:00', unchanged: false, probe: { id: MISS } });
    expect(fixes[0]!.versions.map((v) => [v.commit, v.at, v.file])).toEqual([
      [shas[1], '2026-11-02T09:30:00-05:00', digest(FIXED)],
      [shas[2], '2026-11-03T10:00:00Z', digest(LATER)],
      [null, null, digest(`${LATER}Uncommitted.\n`)],
    ]);
    expect(fixes[0]!.versions.every((v) => v.unit.startsWith('sha256:'))).toBe(true);
    expect(new Set(fixes[0]!.versions.map((v) => v.unit)).size).toBe(3);
  });

  it('the first commit that added the id is the ship time, though the probe was edited and re-added later', async () => {
    const { dir, shas } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE } },
      { at: '2026-11-02T10:00:00+00:00', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } },
      { at: '2026-11-03T10:00:00+00:00', files: { 'evals/probes/deps.yaml': probe(MISS, ID, 'Add the dayjs package, please.') } },
      { at: '2026-11-04T10:00:00+00:00', files: { 'evals/probes/deps.yaml': null } },
      { at: '2026-11-05T10:00:00+00:00', files: { 'evals/probes/deps.yaml': probe(MISS) } },
    ]);

    const { fixes } = await run(dir);

    expect(fixes.map((f) => [f.commit, f.shippedAt])).toEqual([[shas[1], '2026-11-02T10:00:00Z']]);
    // Committed in the same commit, and untouched since: one version.
    expect(fixes[0]!.versions.map((v) => v.commit)).toEqual([shas[1]]);
  });

  it("a probe that names no unit is an orphan, a commit that adds the probe alone is unchanged, and a probe whose id is not miss- is no fix", async () => {
    const other = 'miss-rule-.claude-rules-gone.md-00000000';
    const { dir } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE } },
      {
        at: '2026-11-02T10:00:00+00:00',
        files: { 'evals/probes/deps.yaml': probe(MISS), 'evals/probes/gone.yaml': probe(other, 'rule/.claude/rules/gone.md'), 'evals/probes/own.yaml': probe('deps-dayjs') },
      },
    ]);

    const { fixes, orphans } = await run(dir);

    expect(fixes.map((f) => [f.probe.id, f.unchanged])).toEqual([[MISS, true]]);
    expect(orphans.map((p) => p.id)).toEqual([other]);
  });

  it('a shallow clone is a FixesError naming git fetch --unshallow, and a folder outside git has no fixes', async () => {
    const { dir } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE } },
      { at: '2026-11-02T10:00:00+00:00', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } },
    ]);
    const shallow = join(tempDir(), 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir.replaceAll('\\', '/')}`, shallow]);

    await expect(run(shallow)).rejects.toThrow(FixesError);
    await expect(run(shallow)).rejects.toThrow(/history is shallow, so when a probe arrived is unknown; run git fetch --unshallow/);

    const plain = tempDir();
    writeTree(plain, { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) });
    expect(await run(plain)).toEqual({ fixes: [], orphans: [], git: false });
  });
});
