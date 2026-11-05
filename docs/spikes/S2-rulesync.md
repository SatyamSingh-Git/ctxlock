# Spike S2: rulesync as the compile backend

**Date:** 2026-11-06 · **rulesync:** 43.6.2 (MIT, [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync)) · **Time box:** 1 day; took under an hour · **Code:** [`spikes/rulesync/`](../../spikes/rulesync/)

**Question:** can `ctxlock build` (Plan 2) hand generation to rulesync instead of writing its own emitters for each agent?

**Answer: yes, as an optional backend called through its library API, pinned to an exact version.** rulesync already writes every target we need and most we don't. It does not solve the three problems ctxlock reports, though. It works around one, fixes one, and makes one worse. The parts ctxlock must add are budget fitting, Codex directory scoping, and knowing which files were generated.

## What was run

The fixture ([`spikes/rulesync/fixture/`](../../spikes/rulesync/fixture/)) has the three problems the plan asked about:
- an `AGENTS.md` with the team's conventions, and a `CLAUDE.md` without `@AGENTS.md`, so Claude Code never reads the conventions (`L13`);
- a skill in `.agents/skills`, which Claude Code does not read;
- a rule in `.claude/rules` with `paths: ["src/api/**"]`, which Codex has no way to scope.

[`run.mjs`](../../spikes/rulesync/run.mjs) copies the fixture into a fresh git repository, then calls the library API:
- `importFromTool` for `claudecode`, `agentsmd` and `agentsskills`, with features `rules` and `skills`;
- `generate` for `claudecode`, `codexcli`, `copilot` and `cursor`.

It runs `ctxlock scan` and `ctxlock lint` before and after. `node run.mjs --cli` does the same through the CLI, and produced the same `AGENTS.md` and `CLAUDE.md`.

## What it emitted

```
source tree (.rulesync):
  .rulesync/rules/api.md
  .rulesync/rules/CLAUDE.md
  .rulesync/rules/overview.md
  .rulesync/skills/release/SKILL.md

files generated or changed outside .rulesync:
  new     .claude/skills/release/SKILL.md
  new     .cursor/rules/api.mdc
  new     .cursor/rules/CLAUDE.mdc
  new     .cursor/rules/overview.mdc
  new     .cursor/skills/release/SKILL.md
  new     .github/copilot-instructions.md
  new     .github/instructions/api.instructions.md
  new     .github/skills/release/SKILL.md
  changed AGENTS.md
  changed CLAUDE.md
```

- **Both root files were inlined into each other.** The imported `CLAUDE.md` and `AGENTS.md` both became root rules (`root: true`, `targets: ['*']`). The generated `CLAUDE.md` is the Claude notes followed by the conventions. The generated `AGENTS.md` is the Claude notes, the conventions and the API rule.
- **Path scoping survived for Copilot and Cursor:** `.github/instructions/api.instructions.md` with `applyTo: src/api/**`, and `.cursor/rules/api.mdc` with `globs: src/api/**`. `.claude/rules/api.md` was left as it was.
- **The skill was copied, not linked,** into `.claude/skills`, `.github/skills` and `.cursor/skills`. Codex already reads `.agents/skills`.

## The three problems

| Problem | Result | ctxlock before → after |
|---|---|---|
| Claude Code never reads `AGENTS.md` (`L13`) | **Worked around.** The conventions are now inlined into `CLAUDE.md`, so Claude Code has them, but as a second copy rather than through `@AGENTS.md` | `L13` still fires, since `CLAUDE.md` still has no import. Its suggested fix would now duplicate the text. ctxlock needs to know which files are generated (below) |
| Claude Code cannot see `.agents/skills` | **Fixed,** by a copy in `.claude/skills` | `claude-code` now lists `.claude/skills/release`. `L11` reports each copy as reaching one agent. Since they are identical, they should count as one skill reaching both |
| Codex cannot scope a path rule | **Worse.** The API rule was appended to the root `AGENTS.md`, so Codex now loads it for every file in the repository | Codex's always-loaded bytes went from 77 to 178: the API rule plus the Claude notes. A nested `src/api/AGENTS.md` would have scoped the rule, because Codex loads `AGENTS.md` by directory |

Two side effects:
- **Claude-only notes now reach every agent.** Import marks the old `CLAUDE.md` as `targets: ['*']`, so whatever the team wrote for Claude alone is in `AGENTS.md`, Copilot's and Cursor's rules too. A person has to narrow `targets` after importing.
- **The source tree contains a file named `CLAUDE.md`.** `.rulesync/rules/CLAUDE.md` is a nested `CLAUDE.md` as far as Claude Code is concerned. Claude Code loads it, frontmatter and all, whenever it reads a file in `.rulesync/rules/`. ctxlock predicts this: the file shows up as a lazy unit. It should be renamed after import.

## Library or CLI

**Both.** `import { generate, importFromTool, convertFromTool } from 'rulesync'` has typed options and results. `generate` returns counts and the paths it wrote for each feature. Two options matter for ctxlock:
- **`dryRun`** reports the paths without writing them.
- **`check`** reports what would change. On fresh output it returned `rulesPaths: []`; after `CLAUDE.md` was edited by hand it returned `["CLAUDE.md"]` ([`check.mjs`](../../spikes/rulesync/check.mjs)). That is the drift check Plan 2 needs for generated files.

One quirk: on Windows, `skillsPaths` came back with `\` separators while `rulesPaths` used `/`.

## Cost of depending on it

| | |
|---|---|
| License | MIT |
| Install size | 171 packages, including `@modelcontextprotocol/sdk`, `@octokit/rest`, `chokidar` and `@inquirer/checkbox`. ctxlock has 8 dependencies |
| Node | `engines: >=22.22.0`. It ran on 22.17.1 with an `EBADENGINE` warning. ctxlock supports `>=22` |
| Release cadence | 390 versions since 2025-06-18. In the last three months: 88 releases, **28 of them new major versions**. In the last month: 34 releases |
| Targets | 64, including `claudecode`, `codexcli`, `copilot`, `cursor` and `agentsmd` |

The cadence is the main risk. A new major version every three days or so means the API can break at any time, so the version must be pinned exactly and upgraded on purpose, with the S2 fixture as a test.

## What ctxlock must add

- **Budget fitting.** rulesync concatenates. Nothing in it knows that Codex stops at 32 KiB or that Claude Code cuts a lazy file at 40,000 characters. `ctxlock build` has to check the generated files against the same limits `L3` uses, and move content out (to nested files or skills) when a file would be cut.
- **Codex directory scoping.** For a glob that names a folder (`src/api/**`), write a nested `AGENTS.md` in that folder instead of appending to the root.
- **The compact index.** rulesync has no equivalent of the index the design wants in `AGENTS.md` (a short, pipe-delimited list pointing at docs, from Vercel's result in [research/03](../../research/03-evidence-what-context-works.md)). ctxlock would generate it as a root rule and let rulesync place it.
- **A record of generated files.** With `.ctxlock/generated.json` listing what was generated from what, `L13` and `L11` can judge the sources, and stop reporting a `CLAUDE.md` that already has the conventions inlined, or two identical skill copies.
- **Safe import defaults.** Narrow the `targets` of an imported `CLAUDE.md` to `claudecode`, and rename the imported file so the source tree has no `CLAUDE.md` in it.

## Recommendation for Plan 2

- `ctxlock build` calls rulesync's library API, pinned to one exact version, as an **optional dependency**. Users who never run `build` don't install 171 packages, and `lint` and `diff` never load it.
- ctxlock owns the decisions (which content goes where, what fits, what is scoped) and writes them as a `.rulesync/` source tree. rulesync owns the per-agent file formats, which change often and which it tracks closely.
- `generate({ check: true })` becomes ctxlock's drift check for generated files.
- The S2 fixture and `run.mjs` become the upgrade test: a new rulesync version is taken only when the before/after loads still match.
