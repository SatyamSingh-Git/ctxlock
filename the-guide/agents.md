# Agents: what each one actually loads

The same repository looks different to each coding agent. Claude Code reads `CLAUDE.md` and `.claude/skills`. Codex reads `AGENTS.md` and `.agents/skills`, stops at 32 KiB, and never looks below the directory it starts in. A file one agent relies on can be invisible to the other, or quietly cut in half.

ctxlock predicts, for every agent your team uses, exactly which files end up in context and how many bytes of each. This page explains those predictions and how they are checked.

> **Status:** the predictions for Claude Code and Codex are implemented and tested. `ctxlock scan` and `ctxlock budget` print them ([commands](commands.md)).

## Sites

An agent's context depends on where it starts. ctxlock predicts it at every **site**: the repository root, plus every directory that holds an instructions file (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `CLAUDE.local.md`). A `.claude/CLAUDE.md` belongs to the directory that holds `.claude`.

## How a file is loaded

| Mode | Meaning |
|---|---|
| **always** | In context from the first message. This is what fills the budget. |
| **lazy** | Loaded when the agent reads or edits files under a matching path. |
| **listed** | Only the name and description are in context. The body loads when the skill is invoked. |

## Claude Code

| What | Loaded as | Details |
|---|---|---|
| `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` in the site and every parent directory | always | |
| `AGENTS.md`, `.claude/AGENTS.md` in the site and every parent directory | always, **only if none of the files above exist** | If any of them is in that chain, every `AGENTS.md` in it is ignored, and ctxlock says so. Needs Claude Code 2.1.277 or later. `AGENTS.override.md` is never read. |
| `AGENTS.md` in directories below the site | lazy, **only if no `CLAUDE.md` is in the chain** | And only where that directory has no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` of its own. |
| Files imported with `@path` from an always-on file | always | Followed up to 4 hops deep. `@` inside fenced or inline code is not an import. `@~/...` points outside the repository and is reported as unresolvable. |
| `.claude/rules/*.md` without `paths:`, in the site and every parent directory | always | |
| `.claude/rules/*.md` with `paths:`, in the site and every parent directory | lazy | Loaded when the agent touches a matching file. |
| `.claude/rules/` in directories below the site | lazy | |
| `CLAUDE.md` and `CLAUDE.local.md` in directories below the site | lazy | |
| Skills in `.claude/skills/` of the site and every parent directory | listed | Name, plus description and `when_to_use`, capped at 1,536 characters per skill. A skill with `disable-model-invocation: true` is left out of the listing. |
| Skills in `.claude/skills/` below the site (e.g. `pkg/.claude/skills/` when started at the root) | lazy | Listed once the agent works in that directory. |
| Skills in `.agents/skills/` | **not loaded** | Claude Code does not scan this directory ([anthropics/claude-code#31005](https://github.com/anthropics/claude-code/issues/31005)). |
| A file over 4 MiB that would load at launch | **skipped** | |

Every lazy file counts only its first 40,000 characters: that is Claude Code's per-file cap for on-demand files on 200K-context models. 1M-context models allow 150,000–200,000; set `claudeLazyFileChars` in [`ctxlock.yaml`](configuration.md) if your team uses one.

Claude Code documents no total cap on always-on instructions. It warns when they add up past a combined limit, but does not say how large that is. The skill listing gets 1% of the context window; when it overflows, the descriptions of the least-used skills are dropped first. ctxlock reports both sizes without a limit.

## Codex

| What | Loaded as | Details |
|---|---|---|
| One instructions file per directory, from the repository root down to the site | always | In each directory, `AGENTS.override.md` wins over `AGENTS.md`. Files are concatenated root first. |
| The combined chain | 32,768 bytes total | The file that crosses the limit is truncated to the bytes left. Every file after it is dropped. |
| `AGENTS.md` in directories below the site | **not loaded** | Codex builds its instructions once, when it starts. |
| `CLAUDE.md` | **not loaded** | If a site has `CLAUDE.md` files but no `AGENTS.md` in its chain, ctxlock says so. |
| Skills in `.agents/skills/`, from the site up to the root | listed | Codex gives its whole skill catalog 8,000 characters (or 2% of the context window). ctxlock counts each entry with its repository-relative path; Codex lists the full path, so ctxlock's estimate runs slightly low. |
| Skills in `.claude/skills/` | **not loaded** | Unless the skill is also reachable from `.agents/skills/` (see symlinks below). |

Codex also reads files from your home directory (`~/.codex/AGENTS.md`, `~/.agents/skills`), can be configured with other file names and project-root markers, and loads nothing for untrusted projects. ctxlock looks only at the repository, assumes the defaults, and treats the repository root as the project root.

## Symlinks: one file, both agents

ctxlock follows symlinks inside the repository, to files and to directories. An agent sees the target's content at the symlink's path:
- If the target is already a unit of the same kind, the link becomes another path to that one unit, not a copy.
- Otherwise the link is a unit of its own, read through the link: for example, a rule linked into `.claude/rules/` from a shared folder.

The common patterns:

- `CLAUDE.md -> AGENTS.md`: both agents load the same instructions.
- `.agents/skills/deploy -> ../../.claude/skills/deploy`: both agents see the same skill.
- `.claude/skills -> ../.agents/skills`: every skill in `.agents/skills/` is visible to Claude Code too.

A symlink that points outside the repository is not followed, and ctxlock reports it. A symlink to another symlink is not followed either.

## An example

```
AGENTS.md                         20,000 bytes
CLAUDE.md -> AGENTS.md            (symlink)
services/api/AGENTS.md            15,000 bytes
.claude/skills/deploy/SKILL.md
```

Started in `services/api`:

| | Claude Code | Codex |
|---|---|---|
| Always-on bytes | 20,000 | 32,768 (the limit) |
| `AGENTS.md` (via `CLAUDE.md`) | loaded | loaded, all 20,000 bytes |
| `services/api/AGENTS.md` | **not loaded** | **truncated**: 12,768 of 15,000 bytes |
| `deploy` skill | listed | **not visible** |

What ctxlock tells you about it:

```
claude-code @ services/api
  AGENTS.md at services/api/AGENTS.md not loaded by Claude Code: CLAUDE.md exists
codex @ services/api
  Codex loads only 12768 of 15000 bytes from services/api/AGENTS.md under the 32768-byte project instruction budget
  skill deploy not visible to Codex: .claude/skills is not scanned
```

The API team's instructions are partly lost in Codex and completely lost in Claude Code, and nobody sees an error. Making it visible is the point of ctxlock.

## Limits

Each number above is data in [`src/harness/limits.ts`](../src/harness/limits.ts), with the source it came from. If a vendor changes a limit before ctxlock does, override it in [`ctxlock.yaml`](configuration.md):

```yaml
limits:
  codexChainBytes: 65536   # if you raised project_doc_max_bytes in ~/.codex/config.toml
```

## How the predictions are checked

A prediction is only useful if it is right, so each one is tested against the agent's own behaviour:

- **Codex.** ctxlock's test suite contains Codex's own `AGENTS.md` loader tests, ported from [openai/codex](https://github.com/openai/codex/blob/49f0c6022596c361fe676a5c4738fb2be34e3a93/codex-rs/core/src/agents_md_tests.rs) (Apache-2.0) with the commit recorded. If ctxlock and Codex disagree on one of those cases, the build fails. When Codex's loader changes, the tests are re-ported from the new commit, so the recorded commit tells you which Codex behaviour ctxlock matches.
- **Claude Code.** The predictions follow Claude Code's documented loading rules, and were checked against real headless sessions of Claude Code 2.1.292 ([spike S4](../docs/spikes/S4-telemetry.md)). The sessions ran on a test repository with each kind of file above. ctxlock's prediction matched every file Claude Code reported through its `InstructionsLoaded` hook, with the same reason, including an `AGENTS.md` it did not load because the project has a `CLAUDE.md`. That session is now a test in ctxlock's suite. The check is not automatic yet: it needs a Claude subscription, so it is re-run by hand when Claude Code changes how it loads files.

Two things a repository cannot show ctxlock:
- **Your own setting for `AGENTS.md`.** Claude Code reads `AGENTS.md` through a built-in plugin, whose `instructionFiles` option is read from your user settings or your organisation's managed settings, never from the repository's `.claude/settings.json`. ctxlock predicts the default, `claude-md-or-agents-md`: `AGENTS.md` only where the project has no `CLAUDE.md`. If you, or your organisation, have chosen `claude-md-and-agents-md`, Claude Code loads `AGENTS.md` beside `CLAUDE.md`, and `L13`'s warning does not apply, though it still does to anyone on the default.
- **Your home folder.** Like Codex, Claude Code also loads your own `~/.claude/CLAUDE.md`, and any `CLAUDE.md` in a folder above the repository. ctxlock looks only at the repository.

Found a case where an agent loads something ctxlock didn't predict? That is a bug. Please [open an issue](https://github.com/SatyamSingh-Git/ctxlock/issues) with the file layout and the agent version.
