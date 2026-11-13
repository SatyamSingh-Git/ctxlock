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

  it("a unit added with its probe is not unchanged, and a skill's file added later makes a new version", async () => {
    const SKILL = '---\nname: release\ndescription: Publish a version.\n---\nTag with git tag.\n';
    const id = 'miss-skill-.claude-skills-release-00000000-11111111';
    const { dir, shas } = history([
      { at: '2026-11-01T10:00:00Z', files: { 'README.md': 'r\n' } },
      { at: '2026-11-02T10:00:00Z', files: { '.claude/skills/release/SKILL.md': SKILL, 'evals/probes/r.yaml': probe(id, 'skill/.claude/skills/release') } },
      { at: '2026-11-03T10:00:00Z', files: { '.claude/skills/release/notes.md': 'Notes.\n' } },
    ]);

    const { fixes } = await run(dir);

    expect(fixes.map((f) => [f.probe.id, f.unchanged])).toEqual([[id, false]]);
    // The first version lacks notes.md, so its digest is of SKILL.md alone; the later one has both.
    expect(fixes[0]!.versions.map((v) => [v.commit, v.file])).toEqual([
      [shas[1], digest(SKILL)],
      [shas[2], digest(SKILL)],
    ]);
    expect(fixes[0]!.versions[0]!.unit).not.toBe(fixes[0]!.versions[1]!.unit);
  });

  it("a fix in the repository's first commit has no version before it, so it is not unchanged", async () => {
    const { dir, shas } = history([{ at: '2026-11-01T10:00:00Z', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } }]);

    const { fixes } = await run(dir);

    expect(fixes.map((f) => [f.unchanged, f.versions.map((v) => v.commit)])).toEqual([[false, [shas[0]]]]);
  });

  it('run from a subfolder, it finds the same fixes as from the top', async () => {
    const { dir, shas } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE, 'sub/x.txt': 'x\n' } },
      { at: '2026-11-02T10:00:00+00:00', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } },
      { at: '2026-11-03T10:00:00+00:00', files: { '.claude/rules/deps.md': `${FIXED}More.\n` } },
    ]);

    const { fixes } = await run(join(dir, 'sub'));

    // The working tree is HEAD's bytes, so it adds no version.
    expect(fixes.map((f) => [f.commit, f.versions.map((v) => v.commit)])).toEqual([[shas[1], [shas[1], shas[2]]]]);
  });

  it("a branch that forked before the fix and merged after it brings no version: its commits never had the fix", async () => {
    const { dir, shas } = history([
      { at: '2026-11-01T10:00:00+00:00', files: { '.claude/rules/deps.md': RULE } },
      { at: '2026-11-02T10:00:00+00:00', files: { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) } },
    ]);
    git(dir, 'checkout', '-q', '-b', 'old', shas[0]!);
    writeTree(dir, { '.claude/rules/deps.md': `${RULE}Old branch.\n` });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-03T10:00:00+00:00');
    git(dir, 'commit', '-qam', 'old branch');
    const old = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', 'main');
    // The fix's line wins the merge; the old branch's line is kept below it.
    writeTree(dir, { '.claude/rules/deps.md': `${FIXED}Old branch.\n` });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-04T10:00:00+00:00');
    execFileSync('git', ['merge', '-q', '--no-ff', '-s', 'ours', '--no-commit', 'old'], { cwd: dir });
    writeTree(dir, { '.claude/rules/deps.md': `${FIXED}Old branch.\n` });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'merge old');

    const { fixes } = await run(dir);

    expect(fixes[0]!.versions.map((v) => v.commit)).not.toContain(old);
    expect(fixes[0]!.versions.map((v) => v.file)).not.toContain(digest(`${RULE}Old branch.\n`));
  });

  it('a fix committed on a branch ships when it is merged, not when it was committed', async () => {
    const { dir, shas } = history([{ at: '2026-11-01T10:00:00Z', files: { '.claude/rules/deps.md': RULE } }]);
    git(dir, 'checkout', '-q', '-b', 'fix');
    writeTree(dir, { '.claude/rules/deps.md': FIXED, 'evals/probes/deps.yaml': probe(MISS) });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-02T10:00:00Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'fix');
    const fix = git(dir, 'rev-parse', 'HEAD');
    // A later commit on the branch is not when the fix shipped either.
    writeTree(dir, { 'NOTES.md': 'Still on the branch.\n' });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-04T10:00:00Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'more on the branch');
    git(dir, 'checkout', '-q', 'main');
    writeTree(dir, { 'README.md': 'Meanwhile on main.\n' });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-03T10:00:00Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'main moves on');
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-05T10:00:00Z');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge fix', 'fix');
    writeTree(dir, { 'README.md': 'After the merge.\n' });
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-06T10:00:00Z');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'after');

    const { fixes } = await run(dir);

    expect(fixes.map((f) => [f.commit, f.shippedAt])).toEqual([[fix, '2026-11-05T10:00:00Z']]);
    expect(fixes[0]!.versions[0]!.commit).toBe(fix);
    expect(shas).toHaveLength(1);
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
