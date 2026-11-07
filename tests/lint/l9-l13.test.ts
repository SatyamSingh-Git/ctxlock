import { describe, expect, it } from 'vitest';
import { GENERATED_FILE, serializeGenerated } from '../../src/build/generated.js';
import { sha256Hex } from '../../src/units/digest.js';
import { owners } from '../../src/lint/rules/l10-owner.js';
import { coverage } from '../../src/lint/rules/l11-coverage.js';
import { shadowedAgentsMd } from '../../src/lint/rules/l13-shadowed.js';
import { staleReferences } from '../../src/lint/rules/l9-stale.js';
import type { Rule } from '../../src/lint/types.js';
import { lintContext } from '../helpers/lint.js';

async function run(rule: Rule, files: Record<string, string>, today = '2026-11-05') {
  const ctx = { ...(await lintContext(files)), today };
  return (await rule.check(ctx)).map((f) => [f.rule, f.severity, f.path, f.message]);
}

describe('L9-stale', () => {
  it('`src/missing.ts` is flagged and `src/present.ts` is not', async () => {
    expect(await run(staleReferences, { 'AGENTS.md': 'Edit `src/present.ts`, not `src/missing.ts`. See `NOTES.md`.\n', 'src/present.ts': '' })).toEqual([
      ['L9-stale', 'should', 'AGENTS.md', 'src/missing.ts at 1:29 does not exist'],
      ['L9-stale', 'should', 'AGENTS.md', 'NOTES.md at 1:51 does not exist'],
    ]);
  });

  it("paths resolve from the unit's folder or from the root, and code blocks are not read for paths", async () => {
    expect(
      await run(staleReferences, {
        'pkg/AGENTS.md': 'See `lib/util.ts`, `src/index.ts`, `./lib/`, `../README.md`, `pkg/lib/` and `/src/index.ts`.\n\n```\ncat gone/file.ts\n`not/here.ts`\n```\n',
        'pkg/lib/util.ts': '',
        'src/index.ts': '',
        'README.md': '',
        '.agents/skills/setup/SKILL.md': '---\nname: setup\ndescription: Sets up\n---\nRun `scripts/install.sh`, then `scripts/gone.sh`.\n',
        '.agents/skills/setup/scripts/install.sh': '',
      }),
    ).toEqual([['L9-stale', 'should', '.agents/skills/setup/SKILL.md', 'scripts/gone.sh at 5:33 does not exist']]);
  });

  it('a path that is a symlink, or under a symlinked folder, exists', async () => {
    const ctx = await lintContext(
      { 'AGENTS.md': 'See `CLAUDE.md` and `.claude/skills/deploy/SKILL.md`.\n', '.agents/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: d\n---\n' },
      { 'CLAUDE.md': 'AGENTS.md', '.claude/skills/deploy': '.agents/skills/deploy' },
    );

    expect(await staleReferences.check({ ...ctx, today: '2026-11-05' })).toEqual([]);
  });

  it('`https://x/y.md` and `src/**/*.ts` are not flagged', async () => {
    expect(
      await run(staleReferences, {
        'AGENTS.md': 'See `https://x/y.md`, `src/**/*.ts`, `src/{a,b}.ts`, `<dir>/x.ts`, `$HOME/notes.md`, `config?.json`, `npm test`, `open notes.md`, `../sibling/x.md` and `a.b`.\n',
      }),
    ).toEqual([]);
  });

  it('`npm run build` is flagged when the script is missing, and `pnpm install` never is', async () => {
    // Bare `pnpm X` and `yarn X` also run a dependency's binary when no script has that name, so only
    // the `run` forms and `test` are checked.
    const commands = [
      'npm run build',
      'npm test',
      'pnpm lint',
      'pnpm run typecheck',
      'yarn run dev',
      'pnpm install',
      'yarn add left-pad',
      'pnpm --filter web build',
      'pnpm run',
      'deploy-notes',
      'pnpm vitest run',
      'yarn eslint .',
      'npm run -s lint',
    ];
    const files = {
      'AGENTS.md': `\`\`\`sh\n${commands.join('\n')}\n\`\`\`\n`,
      'package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }),
      'pkg/AGENTS.md': 'Run `npm run build`, `npm test` and `pnpm test`.\n',
      'pkg/package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
      // Config is not instructions: its hook commands are L2's concern.
      '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npm run nope' }] }] } }),
    };

    expect(await run(staleReferences, files)).toEqual([
      ['L9-stale', 'should', 'AGENTS.md', 'npm run build at 2:1: package.json has no "build" script'],
      ['L9-stale', 'should', 'AGENTS.md', 'pnpm run typecheck at 5:1: package.json has no "typecheck" script'],
      ['L9-stale', 'should', 'AGENTS.md', 'yarn run dev at 6:1: package.json has no "dev" script'],
      ['L9-stale', 'should', 'pkg/AGENTS.md', 'npm test at 1:23: pkg/package.json has no "test" script'],
      ['L9-stale', 'should', 'pkg/AGENTS.md', 'pnpm test at 1:38: pkg/package.json has no "test" script'],
    ]);
  });

  it("a skill's own scripts/, references/ and assets/ paths are checked even when that folder is missing", async () => {
    expect(
      await run(staleReferences, {
        '.agents/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploys\n---\nRun `scripts/deploy.sh`, read `references/api.md`, but not `origin/main`.\n',
      }),
    ).toEqual([
      ['L9-stale', 'should', '.agents/skills/deploy/SKILL.md', 'scripts/deploy.sh at 5:6 does not exist'],
      ['L9-stale', 'should', '.agents/skills/deploy/SKILL.md', 'references/api.md at 5:32 does not exist'],
    ]);
  });

  it("another skill's scripts/deploy.sh does not stand in for this skill's own", async () => {
    expect(
      await run(staleReferences, {
        '.agents/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploys\n---\nRun `scripts/deploy.sh`.\n',
        '.agents/skills/release/scripts/deploy.sh': '',
      }),
    ).toEqual([['L9-stale', 'should', '.agents/skills/deploy/SKILL.md', 'scripts/deploy.sh at 5:6 does not exist']]);
  });

  it('package managers named in prose are not commands; only code is read for scripts', async () => {
    expect(
      await run(staleReferences, {
        'AGENTS.md': 'We use pnpm instead of npm, with yarn as a fallback, and npm run nothing here.\n',
        'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      }),
    ).toEqual([]);
  });

  it('tokens that are not repository paths are not flagged, and a bare file name may live anywhere', async () => {
    const text = [
      'Push to `origin/main`, send `application/json`, see `anthropics/claude-code` and `github.com/foo/bar`.',
      'Edit `~/.claude/settings.json` or `/etc/hosts`, call `/engagement/stats`.',
      'Read `node_modules/next/dist/docs/` and `dist/cli.js`, and name the entry point `index.ts`.',
    ].join('\n');

    expect(await run(staleReferences, { 'AGENTS.md': `${text}\n`, 'packages/web/src/index.ts': '' })).toEqual([]);
  });

  it('a gitignored path is an output, not a stale reference, from the root or a nested .gitignore', async () => {
    const files = {
      'AGENTS.md': 'Logs go to `.artifacts/dev.log`, the build writes `web/dist/app.js`, and `docs/gone.md` was removed.\n',
      '.artifacts/README': '',
      'web/src/app.ts': '',
      'docs/index.md': '',
    };
    const stale = (path: string, column: number) => ['L9-stale', 'should', 'AGENTS.md', `${path} at 1:${column} does not exist`];

    expect(await run(staleReferences, { ...files, '.gitignore': '/.artifacts\n', 'web/.gitignore': '/dist\n' })).toEqual([stale('docs/gone.md', 75)]);
    expect(await run(staleReferences, files)).toEqual([stale('.artifacts/dev.log', 13), stale('web/dist/app.js', 52), stale('docs/gone.md', 75)]);
  });

  it('a path found under another folder is relative to a package there, so it is not stale', async () => {
    const text = 'In `tools/lint/`, reuse `src/ast/utils.ts` and `src/ast/`; `src/ast/gone.ts` was removed.\n';
    const files = { 'tools/lint/src/ast/utils.ts': '', 'src/app.ts': '' };

    expect(await run(staleReferences, { ...files, 'AGENTS.md': text })).toEqual([['L9-stale', 'should', 'AGENTS.md', 'src/ast/gone.ts at 1:61 does not exist']]);
  });

  it('placeholder paths such as src/foo/bar.py and my-rule-name.ts are examples', async () => {
    const text = 'Tests mirror sources: `src/foo/bar.py` is tested in `tests/foo/test_bar.py`. Name it `my-rule-name.ts`. Edit `src/real.py`.\n';

    expect(await run(staleReferences, { 'AGENTS.md': text, 'src/app.py': '', 'tests/test_app.py': '' })).toEqual([
      ['L9-stale', 'should', 'AGENTS.md', 'src/real.py at 1:111 does not exist'],
    ]);
  });

  it('an extension on its own is not a file name, but a dotfile with an extension is', async () => {
    expect(await run(staleReferences, { 'AGENTS.md': 'Return `.json` or `.yaml`; servers live in `.mcp.json`.\n' })).toEqual([
      ['L9-stale', 'should', 'AGENTS.md', '.mcp.json at 1:45 does not exist'],
    ]);
  });

  it('scripts are not checked where no package.json is found, or where it does not parse', async () => {
    expect(await run(staleReferences, { 'AGENTS.md': 'Run `npm run build`.\n' })).toEqual([]);
    expect(await run(staleReferences, { 'AGENTS.md': 'Run `npm run build`.\n', 'package.json': '{ invalid' })).toEqual([]);
  });

  it('stale-after 2026-11-04 is flagged with today 2026-11-05, and 2026-11-05 is not', async () => {
    const files = (date: string) => ({ 'AGENTS.md': 'Use pnpm.\n', 'ctxlock.yaml': `version: 1\nunits:\n  AGENTS.md:\n    stale-after: ${date}\n` });

    expect(await run(staleReferences, files('2026-11-04'), '2026-11-05')).toEqual([
      ['L9-stale', 'should', 'AGENTS.md', 'AGENTS.md was due for review by 2026-11-04 (stale-after in ctxlock.yaml)'],
    ]);
    expect(await run(staleReferences, files('2026-11-05'), '2026-11-05')).toEqual([]);
  });

  it('an @import of a missing .md file is info, in instructions and rules', async () => {
    expect(
      await run(staleReferences, {
        'CLAUDE.md': 'Read @docs/here.md and @docs/gone.md, and mail ops@example.com.\nAlso @scripts/gone.sh, @~/.claude/mine.md and @/etc/notes.md.\n',
        '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: Writes notes\n---\nTag @docs/gone.md in the PR.\n',
        'docs/here.md': '',
        '.claude/rules/style.md': 'See @../../docs/also-gone.md\n',
      }),
    ).toEqual([
      ['L9-import-missing', 'info', '.claude/rules/style.md', '@../../docs/also-gone.md: docs/also-gone.md does not exist'],
      ['L9-import-missing', 'info', 'CLAUDE.md', '@docs/gone.md: docs/gone.md does not exist'],
    ]);
  });
});

describe('L10-owner', () => {
  const units = { 'AGENTS.md': 'a', 'CLAUDE.md': 'c' };

  it('no CODEOWNERS and no registry → one info', async () => {
    expect(await run(owners, units)).toEqual([['L10-owner', 'info', undefined, 'No owners: add CODEOWNERS or owners in ctxlock.yaml (2 units)']]);
  });

  it('an empty repository needs no owners, and one unit is counted as one', async () => {
    expect(await run(owners, {})).toEqual([]);
    expect(await run(owners, { 'AGENTS.md': 'a' })).toEqual([['L10-owner', 'info', undefined, 'No owners: add CODEOWNERS or owners in ctxlock.yaml (1 unit)']]);
  });

  it('an unowned skill is reported at its SKILL.md', async () => {
    expect(await run(owners, { 'AGENTS.md': 'a', '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: d\n---\n', CODEOWNERS: 'AGENTS.md @acme\n' })).toEqual([
      ['L10-owner', 'should', '.agents/skills/notes/SKILL.md', '.agents/skills/notes/SKILL.md has no owner in CODEOWNERS or ctxlock.yaml'],
    ]);
  });

  it('CODEOWNERS covering all units → nothing', async () => {
    expect(await run(owners, { ...units, '.github/CODEOWNERS': '* @acme/platform\n' })).toEqual([]);
  });

  it('CODEOWNERS missing one unit → one should, and an owner in ctxlock.yaml covers it', async () => {
    expect(await run(owners, { ...units, '.github/CODEOWNERS': 'AGENTS.md @acme/platform\n' })).toEqual([
      ['L10-owner', 'should', 'CLAUDE.md', 'CLAUDE.md has no owner in CODEOWNERS or ctxlock.yaml'],
    ]);
    expect(
      await run(owners, { ...units, '.github/CODEOWNERS': 'AGENTS.md @acme/platform\n', 'ctxlock.yaml': 'version: 1\nunits:\n  CLAUDE.md:\n    owner: "@sam"\n' }),
    ).toEqual([]);
  });

  it('a registry without owners still asks for an owner per unit', async () => {
    expect(await run(owners, { 'AGENTS.md': 'a', 'ctxlock.yaml': 'version: 1\n' })).toEqual([
      ['L10-owner', 'should', 'AGENTS.md', 'AGENTS.md has no owner in CODEOWNERS or ctxlock.yaml'],
    ]);
  });
});

describe('L11-coverage', () => {
  it('a rule only in .claude/rules gives info "reaches claude-code only"', async () => {
    const files = {
      'AGENTS.md': 'a',
      '.claude/rules/style.md': 'Use tabs.',
      '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: Writes notes\n---\n',
      // Config reaches no agent's context, so there is no coverage to compare.
      '.claude/settings.json': '{}',
    };

    expect(await run(coverage, files)).toEqual([
      ['L11-coverage', 'info', '.agents/skills/notes/SKILL.md', '.agents/skills/notes/SKILL.md reaches codex only'],
      ['L11-coverage', 'info', '.claude/rules/style.md', '.claude/rules/style.md reaches claude-code only'],
    ]);
    expect(await run(coverage, { ...files, 'ctxlock.yaml': 'version: 1\nharnesses: [claude-code]\n' })).toEqual([]);
  });

  it('a CLAUDE.md that only imports AGENTS.md adds nothing of its own, so it is not reported', async () => {
    expect(await run(coverage, { 'AGENTS.md': 'a', 'CLAUDE.md': '@AGENTS.md\n' })).toEqual([]);
    expect(await run(coverage, { 'AGENTS.md': 'a', 'CLAUDE.md': '@AGENTS.md\n\nUse tabs.\n' })).toEqual([
      ['L11-coverage', 'info', 'CLAUDE.md', 'CLAUDE.md reaches claude-code only'],
    ]);
  });

  it('an AGENTS.md that L13 reports is left to L13', async () => {
    expect(await run(coverage, { 'AGENTS.md': 'a', 'CLAUDE.md': 'c' })).toEqual([['L11-coverage', 'info', 'CLAUDE.md', 'CLAUDE.md reaches claude-code only']]);
  });

  it('a skill and the copy ctxlock build generated from it reach both agents between them', async () => {
    const skill = '---\nname: r\ndescription: Releases\n---\nRelease it.\n';
    const files = { '.agents/skills/r/SKILL.md': skill, '.claude/skills/r/SKILL.md': skill };
    const record = serializeGenerated([{ path: '.claude/skills/r/SKILL.md', sha256: sha256Hex(skill), from: [{ path: '.agents/skills/r/SKILL.md', sha256: sha256Hex(skill) }] }]);

    expect(await run(coverage, { ...files, [GENERATED_FILE]: record })).toEqual([]);
    expect(await run(coverage, files)).toEqual([
      ['L11-coverage', 'info', '.agents/skills/r/SKILL.md', '.agents/skills/r/SKILL.md reaches codex only'],
      ['L11-coverage', 'info', '.claude/skills/r/SKILL.md', '.claude/skills/r/SKILL.md reaches claude-code only'],
    ]);
  });
});

describe('L13-agents-md-shadowed', () => {
  it('CLAUDE.md without @AGENTS.md plus an AGENTS.md is flagged', async () => {
    expect(await run(shadowedAgentsMd, { 'AGENTS.md': 'a', 'CLAUDE.md': 'Use pnpm.\n' })).toEqual([
      ['L13-agents-md-shadowed', 'should', 'AGENTS.md', 'Claude Code ignores AGENTS.md because CLAUDE.md exists; add @AGENTS.md to CLAUDE.md'],
    ]);
  });

  it('with the import it is not', async () => {
    expect(await run(shadowedAgentsMd, { 'AGENTS.md': 'a', 'CLAUDE.md': '@AGENTS.md\n' })).toEqual([]);
  });

  it('an AGENTS.md that ctxlock build generated from CLAUDE.md is not, since Claude Code reads what it says', async () => {
    const files = { 'CLAUDE.md': 'Use pnpm.\n', 'AGENTS.md': 'Use pnpm.\n' };
    const record = serializeGenerated([{ path: 'AGENTS.md', sha256: sha256Hex('Use pnpm.\n'), from: [{ path: 'CLAUDE.md', sha256: sha256Hex('Use pnpm.\n') }] }]);

    expect(await run(shadowedAgentsMd, { ...files, [GENERATED_FILE]: record })).toEqual([]);
    expect(await run(coverage, { ...files, [GENERATED_FILE]: record })).toEqual([]);
    expect(await run(shadowedAgentsMd, files)).toHaveLength(1);

    // Generated from a file no agent reads, it reaches Codex alone, and L11 still says so.
    const fromNotes = serializeGenerated([{ path: 'AGENTS.md', sha256: sha256Hex('Use pnpm.\n'), from: [{ path: 'docs/notes.txt', sha256: sha256Hex('n') }] }]);
    expect(await run(coverage, { ...files, 'docs/notes.txt': 'n', [GENERATED_FILE]: fromNotes })).toEqual([
      ['L11-coverage', 'info', 'AGENTS.md', 'AGENTS.md reaches codex only'],
      ['L11-coverage', 'info', 'CLAUDE.md', 'CLAUDE.md reaches claude-code only'],
    ]);
  });

  it('an AGENTS.override.md is Codex-only by design, and an AGENTS.md Claude Code skips for size is not shadowed', async () => {
    expect(await run(shadowedAgentsMd, { 'AGENTS.override.md': 'o', 'CLAUDE.md': 'c' })).toEqual([]);
    expect(await run(shadowedAgentsMd, { 'AGENTS.md': 'a'.repeat(4 * 1024 * 1024 + 1) })).toEqual([]);
  });

  it('a personal CLAUDE.local.md is never the place for the import: a shared CLAUDE.md is suggested instead', async () => {
    expect(await run(shadowedAgentsMd, { 'CLAUDE.md': 'c', 'pkg/CLAUDE.local.md': 'mine', 'pkg/AGENTS.md': 'p' })).toEqual([
      ['L13-agents-md-shadowed', 'should', 'pkg/AGENTS.md', 'Claude Code ignores pkg/AGENTS.md because CLAUDE.md exists; create pkg/CLAUDE.md containing @AGENTS.md'],
    ]);
    expect(await run(shadowedAgentsMd, { 'CLAUDE.local.md': 'mine', 'AGENTS.md': 'a' })).toEqual([
      ['L13-agents-md-shadowed', 'should', 'AGENTS.md', 'Claude Code ignores AGENTS.md because CLAUDE.local.md exists; create CLAUDE.md containing @AGENTS.md'],
    ]);
  });

  it('a .claude/CLAUDE.md speaks for the folder above it', async () => {
    expect(await run(shadowedAgentsMd, { '.claude/CLAUDE.md': 'c', 'AGENTS.md': 'a' })).toEqual([
      ['L13-agents-md-shadowed', 'should', 'AGENTS.md', 'Claude Code ignores AGENTS.md because .claude/CLAUDE.md exists; add @../AGENTS.md to .claude/CLAUDE.md'],
    ]);
  });

  it('with harnesses [codex] it is not', async () => {
    expect(await run(shadowedAgentsMd, { 'AGENTS.md': 'a', 'CLAUDE.md': 'c', 'ctxlock.yaml': 'version: 1\nharnesses: [codex]\n' })).toEqual([]);
  });

  it('a nested AGENTS.md is reported once; the fix keeps it scoped to its folder, as Codex loads it', async () => {
    expect(
      await run(shadowedAgentsMd, { '.claude/CLAUDE.md': 'c', 'pkg/AGENTS.md': 'p', 'pkg/api/AGENTS.md': 'q', 'pkg/api/CLAUDE.md': 'r' }),
    ).toEqual([
      ['L13-agents-md-shadowed', 'should', 'pkg/AGENTS.md', 'Claude Code ignores pkg/AGENTS.md because .claude/CLAUDE.md exists; create pkg/CLAUDE.md containing @AGENTS.md'],
      ['L13-agents-md-shadowed', 'should', 'pkg/api/AGENTS.md', 'Claude Code ignores pkg/api/AGENTS.md because pkg/api/CLAUDE.md exists; add @AGENTS.md to pkg/api/CLAUDE.md'],
    ]);
  });
});
