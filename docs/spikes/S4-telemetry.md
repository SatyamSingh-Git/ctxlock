# Spike S4: joining Claude Code's load events to ctxlock's units

**Date:** 2026-11-06 · **Claude Code:** 2.1.292 · **Harness:** [S1's](S1-eval-runner.md), with its `InstructionsLoaded` and `PostToolUse` (Skill) hooks · **Sessions:** 3, plus the 30 adherence runs from [S3](S3-reproduction.md) · **Code:** [`spikes/telemetry/s4.mjs`](../../spikes/telemetry/s4.mjs)

**Question:** can what Claude Code actually loads in a session be matched to the units ctxlock knows about, and does ctxlock's prediction of what loads hold up against it?

**Answer:**
- **The join works.** Every load seen was joined to a unit by its path and content digest.
- **The prediction matched on every point tested:** six units loaded as predicted, with the predicted reason. The one file and one skill that ctxlock says Claude Code never sees did not appear.
- **No resolver fix was needed.**
- **One real gap.** When Claude Code reads `AGENTS.md` because a project has no `CLAUDE.md`, nothing records it: no hook fires, and nothing in the output mentions it.

## The fixture and the sessions

The fixture has one of each thing that loads differently:
- a `CLAUDE.md` that imports `AGENTS.md`;
- a rule without `paths:`, and one scoped to `packages/api/**`;
- a nested `packages/api/CLAUDE.md`;
- a `packages/web/AGENTS.md`, which Claude Code should ignore because the project has a `CLAUDE.md` (`L13`);
- a skill in `.claude/skills`, and one in `.agents/skills`, which Claude Code does not scan.

| Session | Prompt |
|---|---|
| api | "Read packages/api/handler.ts and tell me in one sentence what it exports." |
| web | "Read packages/web/app.ts and tell me in one sentence what it exports." |
| release | "Publish a new version of this project." |

## Predicted against observed

| File | ctxlock predicts | Seen in api | Seen in web | Seen in release |
|---|---|---|---|---|
| `CLAUDE.md` | always (`ancestor`) | `session_start` | `session_start` | `session_start` |
| `AGENTS.md` | always (`import:CLAUDE.md`) | `include`, parent `CLAUDE.md` | same | same |
| `.claude/rules/style.md` | always (`rule`) | `session_start` | `session_start` | `session_start` |
| `.claude/rules/api.md` | lazy (`paths-glob`) | `path_glob_match`, trigger `packages/api/handler.ts` | — | — |
| `packages/api/CLAUDE.md` | lazy (`nested`) | `nested_traversal`, trigger `packages/api/handler.ts` | — | — |
| `.claude/skills/release` | listed | listed | listed | listed, and invoked |
| `packages/web/AGENTS.md` | not loaded: `CLAUDE.md` exists | — | **not loaded**, though the session read `packages/web/app.ts` | — |
| `.agents/skills/notes` | not visible | not listed | not listed | not listed |

"Listed" comes from the session's init message, which names every skill the model can pick. "Invoked" comes from the `PostToolUse` hook on the Skill tool.

**Resolver accuracy: 8 of 8, so nothing to fix.** The web session is the one that matters most. It is behavioural proof of `L13`: an `AGENTS.md` beside code that Claude Code reads is still not loaded when the project has a `CLAUDE.md`. That is the case in getsentry/sentry's two nested `AGENTS.md` files ([the dogfood report](../dogfood/2026-11-06-static.md)).

## The join keys

`InstructionsLoaded` gives an absolute `file_path` and the session's `cwd`. The join takes three steps:
1. **Path.** `file_path` relative to `cwd`, with `/` separators, is a unit's path or one of its symlink aliases. A skill's `SKILL.md` maps to the skill's folder.
2. **Content.** The file's `sha256` is computed, and for a one-file unit, `sha256("<path>\0<that sha256>\n")` is the unit's `digest` in `ctxlock scan --format json`. All five files here matched. A mismatch would mean the session loaded a different version of the file than the one ctxlock scanned.
3. **Unit ID.** Path plus digest gives the unit ID, for example `rule/.claude/rules/api.md`.

## What Claude Code exposes

**`InstructionsLoaded`** fires once per file:

| Field | What it carries |
|---|---|
| `file_path` | the file loaded |
| `memory_type` | `Project` here. A copy under the home folder also loaded `~/.claude/CLAUDE.md` as `Project` ([S1](S1-eval-runner.md)), so the type alone does not tell a user's file from a repository's |
| `load_reason` | `session_start`, `include`, `nested_traversal` or `path_glob_match` |
| `parent_file_path` | the importing file, for `include` |
| `trigger_file_path` | the file whose read caused a lazy load |
| `globs` | for a path rule, Claude Code's normalised patterns: `paths: ["packages/api/**"]` arrives as `["packages/api"]` |

The hooks run asynchronously, so the events arrive in no fixed order.

**`PostToolUse`** on `Skill` gives the skill invoked, in `tool_input.skill`.

**The `stream-json` init message** lists the skills the model can choose from (23 here: the fixture's `release` and the built-in ones) and the memory paths.

## The gaps

- **`AGENTS.md` read through Claude Code's fallback is invisible.**
  - Claude Code 2.1.292 reads `AGENTS.md` through a built-in plugin, `cc-plugin-agents-md`, when a project has no `CLAUDE.md`.
  - In all 30 of S3's adherence runs, which had no `CLAUDE.md`, the head arm followed its `AGENTS.md` every time. Yet `InstructionsLoaded` never fired, and the stream did not mention `AGENTS.md` at all.
  - The plugin reports the load only to its own analytics (`agents_md_load`).
  - A collector built on hooks will therefore see nothing in exactly the repositories that use only `AGENTS.md`. Plan 2 needs another signal: either the agent's first `Read` of the file, or a `SessionStart` hook that records what the plugin would choose, using ctxlock's own prediction.
- **Each developer can change how `AGENTS.md` loads.** The plugin has an `instructionFiles` option, stored under `pluginConfigs` in the user's own settings, not the project's:
  - `claude-md`: CLAUDE.md only;
  - `claude-md-or-agents-md`: the default;
  - `claude-md-and-agents-md`: AGENTS.md beside CLAUDE.md, without loading an imported file twice;
  - `managed-only`.

  A repository can't see or set this, so ctxlock predicts the default. For a developer who chose `claude-md-and-agents-md`, `L13` doesn't apply. That belongs in the guide's agents page.
- **Symlinked files were not tested.** Whether `file_path` reports the link or its target decides whether the join uses aliases. ctxlock already maps both.
- **Codex** was not observed, by design. It has no hooks of this kind on this machine. Its prediction is checked by the ported loader tests from Task 5.
