# Spike S5: a Claude Code plugin as ctxlock's collector

**Date:** 2026-11-08 · **Claude Code:** 2.1.292 · **Session:** 1, `claude -p --plugin-dir`, sonnet · **Code:** a throwaway plugin whose hooks appended each payload, and the environment the hook saw, to a log

**Question:** can a plugin's hooks record what Claude Code loads in a developer's own sessions, and what do they receive?

**Answer:**
- **Yes.** A plugin with hooks on `SessionStart`, `InstructionsLoaded`, `PostToolUse` (Skill) and `SessionEnd` passed `claude plugin validate` with one warning, for a missing `author`. Loaded with `--plugin-dir`, every hook fired in a `-p` session.
- **The payloads carry what S4's join needs,** and no file content.
- **Three findings shape the design:**
  - **The plugin's data folder can't serve as the store.** Its name depends on how the plugin was installed.
  - **A hook inherits the whole environment of the process that started Claude Code,** tokens included.
  - **Plugins a user installs do not load in ctxlock's eval runs.**

## The session

The fixture had:
- a `CLAUDE.md`;
- a rule with no `paths:`;
- a nested `packages/api/CLAUDE.md`;
- a skill, `.claude/skills/release`.

The prompt had the agent read `packages/api/handler.ts`, then explain how to publish a new version "using the project's release skill".

| # | Hook | What it carried |
|---|---|---|
| 1 | `InstructionsLoaded` | `~/.claude/CLAUDE.md`, `memory_type: User`, `load_reason: session_start` |
| 2 | `InstructionsLoaded` | `CLAUDE.md`, `Project`, `session_start` |
| 3 | `InstructionsLoaded` | `.claude/rules/style.md`, `Project`, `session_start` |
| 4 | `SessionStart` | `source: startup` |
| 5 | `InstructionsLoaded` | `packages/api/CLAUDE.md`, `nested_traversal`, `trigger_file_path` `packages/api/handler.ts` |
| 6 | `PostToolUse` | `tool_name: Skill`, `tool_input: {"skill":"release"}`, `tool_response: {"success":true,"commandName":"release"}` |
| 7 | `SessionEnd` | `reason: other` |

Every payload also has:
- `session_id`;
- `transcript_path`;
- `cwd`, a Windows path with backslashes;
- `hook_event_name`.

Payloads after the first prompt add `prompt_id` and `effort`. Paths are absolute.

## Findings

- **Session-start loads arrive before `SessionStart`.** A collector can't use `SessionStart` to open a session. Each event has to stand on its own, keyed by `session_id`.
- **No payload names the model.** The spec's `context.load` has a `model` field. The hooks can't fill it.
- **A skill call gives its name only.** The response has no path, no digest and no content. Matching the call to a unit means matching that name to the skills Claude Code lists, as S4's join already does.
- **The user's own `~/.claude/CLAUDE.md` is reported** (`memory_type: User`). In S1, a copy of a repository under the home folder reported it as `Project`, so a collector has to decide what is the repository's by path, not by type.
- **The plugin's data folder.** The hook gets three folders in its environment:
  - `CLAUDE_PLUGIN_ROOT`, the plugin's folder;
  - `CLAUDE_PROJECT_DIR`, the project;
  - `CLAUDE_PLUGIN_DATA`, `~/.claude/plugins/data/<id>`.

  For `--plugin-dir`, the `<id>` was `s5-dump-inline`. An installed plugin gets another, so ctxlock's own commands can't count on finding that folder.
- **A hook inherits the whole environment of the process that started Claude Code.** In this session that included the parent session's messaging token. A collector must never record its environment.
- **Plugins a user installs don't load in ctxlock's eval runs.** Eval runs pass `--setting-sources project`. The init message of a Plan 2 eval stream lists only Claude Code's two built-in plugins (`cc-plugin-agents-md` and `cc-plugin-plugin-authoring`). The user's installed plugins, superpowers among them, are not there. A collector installed for a developer won't record ctxlock's own eval sessions.

## What it means for Plan 5

- **The collector is a plugin in ctxlock's repository,** and the repository is its own marketplace.
- **Its hook writes one JSON line per event** to a store under the user's home folder, which ctxlock's commands can find.
- **It records:**
  - each event's session, `cwd`, timestamp and reason;
  - for a file, its path and a digest of its bytes;
  - for a skill, its name.

  Nothing else.
- **Units are matched at query time,** by S4's join. An `AGENTS.md` that Claude Code reads through its fallback still reports nothing (S4), so ctxlock adds it from its own prediction, labelled "predicted".
