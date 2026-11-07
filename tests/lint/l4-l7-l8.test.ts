import { describe, expect, it } from 'vitest';
import { GENERATED_FILE, serializeGenerated } from '../../src/build/generated.js';
import { discoverable } from '../../src/lint/rules/l4-discoverable.js';
import { duplicateSkills } from '../../src/lint/rules/l7-duplicates.js';
import { procedure } from '../../src/lint/rules/l8-procedure.js';
import type { Rule } from '../../src/lint/types.js';
import { lfDigest } from '../../src/units/digest.js';
import { lintContext } from '../helpers/lint.js';

async function run(rule: Rule, files: Record<string, string>, symlinks: Record<string, string> = {}) {
  return (await rule.check(await lintContext(files, symlinks))).map((f) => [f.severity, f.path, f.message]);
}

const skill = (name: string, description: string, body = 'Steps.\n') => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

describe('L4-discoverable', () => {
  const tree = ['```', 'src/', '├── cli.ts', '├── lint/', '│   └── run.ts', '└── model.ts', '```'].join('\n');

  it('a fenced directory tree is flagged', async () => {
    expect(await run(discoverable, { 'AGENTS.md': `# Conventions\n\nUse pnpm.\n\n${tree}\n` })).toEqual([
      ['should', 'AGENTS.md', '4-line directory tree at 7:1; agents can list the files themselves'],
    ]);
  });

  it('two tree lines are not a tree, and a line with only a vertical bar is one', async () => {
    expect(await run(discoverable, { 'AGENTS.md': 'src/\n├── cli.ts\n└── model.ts\n' })).toEqual([]);
    expect(await run(discoverable, { 'AGENTS.md': 'src/\n├── cli.ts\n│   (generated)\n└── model.ts\n' })).toEqual([
      ['should', 'AGENTS.md', '3-line directory tree at 2:1; agents can list the files themselves'],
    ]);
  });

  it('## Project structure is flagged, and an overview heading inside its section is part of it', async () => {
    const text = '# Guide\n\n## Project structure\n\nThe code is in src.\n\n### Repo layout\n\n## Testing\n\n### Directory map\n';

    expect(await run(discoverable, { 'AGENTS.md': text })).toEqual([
      ['should', 'AGENTS.md', 'heading "## Project structure" at 3:1 introduces a repository overview; agents can list the files themselves'],
      ['should', 'AGENTS.md', 'heading "### Directory map" at 11:1 introduces a repository overview; agents can list the files themselves'],
    ]);
  });

  it('## Project overview says what the project is, while ## Codebase overview maps it', async () => {
    expect(await run(discoverable, { 'AGENTS.md': '## Project Overview\n\n`skills` is the CLI for agent skills.\n\n## Codebase overview\n' })).toEqual([
      ['should', 'AGENTS.md', 'heading "## Codebase overview" at 5:1 introduces a repository overview; agents can list the files themselves'],
    ]);
  });

  it('## Testing is not, and neither is a heading-like comment in a code block', async () => {
    expect(await run(discoverable, { 'AGENTS.md': '## Testing\n\n```sh\n# file tree\nls -R\n```\n' })).toEqual([]);
  });

  it('only files loaded at launch are checked, unscoped rules included', async () => {
    expect(
      await run(discoverable, {
        'CLAUDE.md': 'Use pnpm.',
        '.claude/rules/layout.md': `## Directory map\n`,
        '.claude/rules/api.md': `---\npaths: ["src/api/**"]\n---\n## Directory map\n`,
      }),
    ).toEqual([['should', '.claude/rules/layout.md', 'heading "## Directory map" at 1:1 introduces a repository overview; agents can list the files themselves']]);
  });
});

describe('L7-duplicate-skill', () => {
  it('two descriptions differing by one word are flagged', async () => {
    expect(
      await run(duplicateSkills, {
        '.agents/skills/deploy/SKILL.md': skill('deploy', 'Deploys the web app to staging and production'),
        '.agents/skills/ship/SKILL.md': skill('ship', 'Deploys the web app to staging and preview'),
      }),
    ).toEqual([
      [
        'should',
        '.agents/skills/ship/SKILL.md',
        'description is a near-duplicate of skill deploy (.agents/skills/deploy/SKILL.md): 67% of their words are shared, so an agent may pick the wrong one',
      ],
    ]);
    expect(
      await run(duplicateSkills, {
        '.agents/skills/fmt/SKILL.md': skill('fmt', 'Formats SQL Migrations'),
        '.agents/skills/sqlfmt/SKILL.md': skill('sqlfmt', 'formats sql migrations safely'),
      }),
    ).toEqual([
      [
        'should',
        '.agents/skills/sqlfmt/SKILL.md',
        'description is a near-duplicate of skill fmt (.agents/skills/fmt/SKILL.md): 75% of their words are shared, so an agent may pick the wrong one',
      ],
    ]);
  });

  it('unrelated descriptions are not', async () => {
    expect(
      await run(duplicateSkills, {
        '.agents/skills/deploy/SKILL.md': skill('deploy', 'Deploys the web app to staging and production'),
        '.agents/skills/notes/SKILL.md': skill('notes', 'Writes release notes from the merged pull requests'),
      }),
    ).toEqual([]);
  });

  it('stopwords and short words do not make descriptions look alike', async () => {
    expect(
      await run(duplicateSkills, {
        '.agents/skills/a/SKILL.md': skill('a', 'Use this when you want the app'),
        '.agents/skills/b/SKILL.md': skill('b', 'Use this when you need the db'),
      }),
    ).toEqual([]);
    expect(
      await run(duplicateSkills, {
        '.agents/skills/a/SKILL.md': skill('a', 'Go to it by an OS in UI'),
        '.agents/skills/b/SKILL.md': skill('b', 'Go to it by an OS in DB'),
      }),
    ).toEqual([]);
  });

  it('the same name with different digests is flagged as diverged', async () => {
    expect(
      await run(duplicateSkills, {
        '.agents/skills/deploy/SKILL.md': skill('deploy', 'Deploys the app', 'Run make deploy.\n'),
        '.claude/skills/deploy/SKILL.md': skill('deploy', 'Deploys the app', 'Run make release.\n'),
      }),
    ).toEqual([['should', '.claude/skills/deploy/SKILL.md', 'diverged copies: skill deploy at .agents/skills/deploy and .claude/skills/deploy have different contents']]);
  });

  it('leaves a copy ctxlock generated to L14, whether its source changed or someone edited it', async () => {
    const old = skill('deploy', 'Deploys the app', 'Run make deploy.\n');
    const record = serializeGenerated([
      { path: '.claude/skills/deploy/SKILL.md', sha256: lfDigest(Buffer.from(old)), from: [{ path: '.agents/skills/deploy/SKILL.md', sha256: lfDigest(Buffer.from(old)) }] },
    ]);
    const newer = skill('deploy', 'Deploys the app', 'Run make release.\n');

    expect(await run(duplicateSkills, { '.agents/skills/deploy/SKILL.md': newer, '.claude/skills/deploy/SKILL.md': old, [GENERATED_FILE]: record })).toEqual([]);
    expect(await run(duplicateSkills, { '.agents/skills/deploy/SKILL.md': old, '.claude/skills/deploy/SKILL.md': newer, [GENERATED_FILE]: record })).toEqual([]);

    // A copy made the other way, into .agents/skills.
    const back = serializeGenerated([
      { path: '.agents/skills/deploy/SKILL.md', sha256: lfDigest(Buffer.from(old)), from: [{ path: '.claude/skills/deploy/SKILL.md', sha256: lfDigest(Buffer.from(old)) }] },
    ]);
    expect(await run(duplicateSkills, { '.agents/skills/deploy/SKILL.md': old, '.claude/skills/deploy/SKILL.md': newer, [GENERATED_FILE]: back })).toEqual([]);

    // A file a person added to the copy is in no record, so L14 never sees it, and L7 still does.
    expect(
      await run(duplicateSkills, { '.agents/skills/deploy/SKILL.md': old, '.claude/skills/deploy/SKILL.md': old, '.claude/skills/deploy/notes.md': 'mine', [GENERATED_FILE]: record }),
    ).toEqual([['should', '.claude/skills/deploy/SKILL.md', 'diverged copies: skill deploy at .agents/skills/deploy and .claude/skills/deploy have different contents']]);
  });

  it('a script that differs between two copies makes them diverged', async () => {
    const md = skill('deploy', 'Deploys the app');

    expect(
      await run(duplicateSkills, {
        '.agents/skills/deploy/SKILL.md': md,
        '.agents/skills/deploy/scripts/run.sh': 'make deploy',
        '.claude/skills/deploy/SKILL.md': md,
        '.claude/skills/deploy/scripts/run.sh': 'make release',
      }),
    ).toEqual([['should', '.claude/skills/deploy/SKILL.md', 'diverged copies: skill deploy at .agents/skills/deploy and .claude/skills/deploy have different contents']]);
  });

  it('same-named skills in different packages are not copies of each other', async () => {
    const files = Object.fromEntries(
      [0, 1, 2].map((i) => [`packages/p${i}/.claude/skills/test/SKILL.md`, skill('test', 'Runs the package tests with vitest', `Run step ${i}.\n`)]),
    );

    expect(await run(duplicateSkills, files)).toEqual([]);
  });

  it('look-alike skills that no agent lists together are not near-duplicates', async () => {
    expect(
      await run(duplicateSkills, {
        '.claude/skills/deploy/SKILL.md': skill('deploy', 'Deploys the web app to staging and production'),
        '.agents/skills/ship/SKILL.md': skill('ship', 'Deploys the web app to staging and preview'),
        'packages/a/.claude/skills/build/SKILL.md': skill('build', 'Builds the web app for staging and production'),
        'packages/b/.claude/skills/bundle/SKILL.md': skill('bundle', 'Builds the web app for staging and preview'),
      }),
    ).toEqual([]);
  });

  it('a symlink alias is not flagged', async () => {
    expect(await run(duplicateSkills, { '.agents/skills/deploy/SKILL.md': skill('deploy', 'Deploys the app') }, { '.claude/skills/deploy': '.agents/skills/deploy' })).toEqual(
      [],
    );
  });

  it('an identical copy is not flagged', async () => {
    const md = skill('deploy', 'Deploys the web app to staging and production');

    expect(
      await run(duplicateSkills, {
        '.agents/skills/deploy/SKILL.md': md,
        '.agents/skills/deploy/scripts/run.sh': 'make deploy',
        '.claude/skills/deploy/SKILL.md': md,
        '.claude/skills/deploy/scripts/run.sh': 'make deploy',
      }),
    ).toEqual([]);
  });
});

describe('L8-procedure', () => {
  const phrases = [
    'Always run the tests first.',
    'You must verify the build.',
    'Never skip the lint check.',
    'Always rerun the migrations.',
    'You MUST confirm with the user.',
  ];

  it('5 mandatory-verification phrases give info', async () => {
    expect(await run(procedure, { '.agents/skills/release/SKILL.md': skill('release', 'Cuts a release', `${phrases.join('\n')}\n`) })).toEqual([
      ['info', '.agents/skills/release/SKILL.md', 'skill release: 5 mandatory checks and checklist items; excessive procedure is the most common way skills fail'],
    ]);
  });

  it('4 give nothing', async () => {
    expect(await run(procedure, { '.agents/skills/release/SKILL.md': skill('release', 'Cuts a release', `${phrases.slice(0, 4).join('\n')}\nAlways be kind.\n`) })).toEqual([]);
  });

  it('checklist items count too, in rules as well as skills, and instructions files are not checked', async () => {
    const checklist = `${phrases.slice(0, 3).join('\n')}\n- [ ] tag the release\n  - [ ] post the notes\n- [x] done already\n`;

    expect(await run(procedure, { '.claude/rules/release.md': checklist, 'AGENTS.md': `${phrases.join('\n')}\n` })).toEqual([
      ['info', '.claude/rules/release.md', 'rule release: 5 mandatory checks and checklist items; excessive procedure is the most common way skills fail'],
    ]);
  });
});
