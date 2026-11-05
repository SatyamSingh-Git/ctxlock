# Commands: `scan`, `lint`, `budget`

ctxlock reads your repository's agent context and reports on it. It never changes a file in the repository it reads, and nothing it reads leaves your machine.

> **Status:** these three commands are implemented and tested. ctxlock is not on npm yet. To run it today, build it from source:
>
> ```sh
> git clone https://github.com/SatyamSingh-Git/ctxlock.git
> cd ctxlock && npm ci && npm run build
> node dist/cli.js scan /path/to/your/repo
> ```
>
> `ctxlock diff` and the GitHub Action are being built next.

Each command takes the directory to check, defaulting to the current one, and two options:

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

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. For `lint`, no `must` finding remained after your `lint.severity` settings |
| 1 | `lint` only: at least one `must` finding |
| 2 | Could not run: a bad argument, a directory that does not exist, or an invalid `ctxlock.yaml`. The reason is printed on stderr |

`scan` and `budget` exit 0 whatever they find, so you can run them anywhere without failing a build.
