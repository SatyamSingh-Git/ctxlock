# Dogfood: the collector, live

**Date:** 2026-11-08 · **Claude Code:** 2.1.292 · **Model:** sonnet · **Sessions:** 7 (five on fixtures, one rerun, one on a public repository) · **Plan:** [Plan 5](../superpowers/plans/2026-11-08-ctxlock-collectors.md)

**Question:** do the loads ctxlock reports, from the collector's records, match what Claude Code itself says it loaded? That is the exit criterion of the spec's Phase 2: "Observed edges match `InstructionsLoaded` ground truth".

**Answer:** yes, exactly.
- **On S4's fixture:**
  - **Every load matched.** Each unit, session count and load reason from `ctxlock loads` matched Claude Code's raw `InstructionsLoaded` and Skill events, recorded by a second plugin in the same sessions.
  - **Nothing from outside the repository was listed,** though every session also loaded the user's own `CLAUDE.md`.
- **On a public repository,** a skill the agent invoked was joined to its unit.
- **One surprise:** in one session of six, Claude Code reported no load event at all.

## How it was checked

Each session ran `claude -p --model sonnet` with two plugins:
- **ctxlock's collector** (`--plugin-dir plugin`), writing to a scratch `CTXLOCK_HOME`;
- **a dump plugin** that appended every `SessionStart`, `InstructionsLoaded` and Skill payload as Claude Code sent it.

A script derived the expected units, sessions and reasons from the dump alone, and compared them with `ctxlock loads --format json`.

The fixtures were:
- **S4's fixture again** ([S4](../spikes/S4-telemetry.md)):
  - a `CLAUDE.md` importing `AGENTS.md`;
  - a rule with no `paths:`, and one scoped to `packages/api/**`;
  - a nested `packages/api/CLAUDE.md`;
  - a `packages/web/AGENTS.md`;
  - a skill in `.claude/skills`, and one in `.agents/skills`.
- **A repository with only an `AGENTS.md`.**
- **One with an `AGENTS.md` and a rule.**

## S4's fixture: three sessions

The prompts were S4's: read `packages/api/handler.ts`; read `packages/web/app.ts`; "Publish a new version of this project."

```
ctxlock loads · 3 Claude Code sessions, 2026-11-08

Loaded:
  .claude/rules/style.md  3 sessions  session_start  last 2026-11-08
  AGENTS.md               3 sessions  import         last 2026-11-08
  CLAUDE.md               3 sessions  session_start  last 2026-11-08
  .claude/rules/api.md    1 session   glob           last 2026-11-08
  .claude/skills/release  1 session   skill_invoked  last 2026-11-08
  packages/api/CLAUDE.md  1 session   nested         last 2026-11-08

These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.
```

| From the raw events | `ctxlock loads` |
|---|---|
| `CLAUDE.md`: 3 sessions, `session_start` | the same |
| `.claude/rules/style.md`: 3, `session_start` | the same |
| `AGENTS.md`: 3, `include` | 3, `import` |
| `packages/api/CLAUDE.md`: 1, `nested_traversal` | 1, `nested` |
| `.claude/rules/api.md`: 1, `path_glob_match` | 1, `glob` |
| Skill `release`: 1 | `.claude/skills/release`: 1, `skill_invoked` |
| `C:\Users\…\.claude\CLAUDE.md`, in all 3 | not listed: outside the repository |

**What was not loaded matches the prediction too:**
- `packages/web/AGENTS.md` never loaded, though the web session read the file beside it. That is `L13`: Claude Code ignores an `AGENTS.md` when the project has a `CLAUDE.md`.
- `.agents/skills/notes` never appeared: Claude Code doesn't scan `.agents/skills`.

Neither is in "Not loaded in these sessions" either, because ctxlock does not predict that Claude Code can load them. Every unit it does predict was loaded, so that section is empty.

## The `AGENTS.md` fallback

**In the repository with only an `AGENTS.md`, Claude Code reported no load of it.** The agent followed it all the same, as S3 and S4 found.

ctxlock lists it from its prediction:

```
ctxlock loads · 1 Claude Code session, 2026-11-08

Loaded:
  AGENTS.md  1 session  session_start (predicted)  last 2026-11-08

These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.
```

**With a rule beside the `AGENTS.md`, the rule's load was reported,** as was the user's `CLAUDE.md`. The `AGENTS.md` still reported nothing, though the agent quoted it: "`AGENTS.md` also says to use pnpm".

## A session that reported nothing

**The first session in the `AGENTS.md`-only repository reported no `InstructionsLoaded` at all.**
- Not even the user's own `CLAUDE.md` was reported, which loads in every session.
- The dump plugin missed it too, so Claude Code sent no event; the collector did not drop one.
- A rerun of the same session reported it.

**That is one session in six with a load Claude Code didn't report.** For ctxlock, it means:
- A session count can be one short.
- "Not loaded in these sessions" needs more than a few sessions before it means much.

The guide [says so](../../the-guide/collector.md#what-it-cant-see).

## A public repository: plano

[katanemo/plano](https://github.com/katanemo/plano) has a root `CLAUDE.md` and eight skills in `.claude/skills`. One session asked how to build the CLI, "using the project's skill for it if there is one".

```
ctxlock loads · 1 Claude Code session, 2026-11-08

Loaded:
  .claude/skills/build-cli  1 session  skill_invoked  last 2026-11-08
  CLAUDE.md                 1 session  session_start  last 2026-11-08

Not loaded in these sessions:
  .claude/skills/build-brightstaff  listed
  .claude/skills/build-wasm         listed
  .claude/skills/check              listed
  .claude/skills/test-python        listed

These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.
```

```
ctxlock who-uses · .claude/skills/build-cli

Nothing in ctxlock.yaml depends on it.

Loaded by (predicted):
  claude-code  .       listed
  claude-code  skills  listed

Loaded in sessions (observed):
  claude-code  1 of 1 session  skill_invoked  last 2026-11-08
```

**Three of the eight skills never appear:** `new-provider`, `pr` and `release`. Each sets `disable-model-invocation: true`. Claude Code doesn't offer them to the model, so ctxlock neither predicts them as listed nor reports them as not loaded.

## What the final review found

A fresh review reproduced two cases, which these fixtures did not cover, where "Not loaded in these sessions" was wrong:
- **In a repository with no `CLAUDE.md`, every `AGENTS.md` below the top was listed as not loaded.** Claude Code reads those through the same fallback, and reports nothing for them either.
- **Every session was judged as if it had started at the top of the repository.**
  - A skill that a package offers, invoked from that package's folder, was listed as not loaded.
  - A root `AGENTS.md` was predicted even for a session under a folder with its own `CLAUDE.md`.

Both are fixed:
- Each session is now judged by the folder it started in.
- What Claude Code never reports is left out of the list.

Rerun on the stores above, the output is unchanged, and the S4 comparison still matches exactly.

## What it cost

Seven sessions on the subscription, each a minute or two.

The collector adds one Node process per event. A session here wrote four to seven lines.
