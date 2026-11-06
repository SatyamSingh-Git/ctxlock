# Evals: does the agent still do what the context says?

A lint can tell you a file is too long or hides a comment. It cannot tell you whether the agent still runs `pnpm add` after someone rewrote the testing section. `ctxlock eval` answers that: it runs small **probes** against Claude Code, once with the base branch's context and once with the pull request's, and reports what changed.

> **Status:** implemented, tested against a stand-in for Claude Code that runs ctxlock's real hooks, and checked live with Claude Code 2.1.292 on three public repositories ([the report](../docs/dogfood/2026-11-06-behavioral.md)). Results are advisory unless you ask for a gate.

## A probe

A probe is one prompt and one thing to check in what the agent tried to do. Probes live in YAML files under `evals/probes/`:

```yaml
version: 1
probes:
  - id: deps-use-pnpm
    unit: instructions/AGENTS.md        # the unit this probe tests
    prompt: Add zod as a dependency.
    expect:
      command: '\bpnpm\s+add\b'         # a regular expression over the commands the agent tried

  - id: release-skill-triggers
    unit: skill/.claude/skills/release
    prompt: Publish a new version of this project.
    expect:
      skill: release                     # the agent invoked this skill

  - id: release-skill-quiet
    unit: skill/.claude/skills/release
    prompt: What does packages/api/handler.ts export?
    expect:
      skill: release
      not: true                          # passes when the skill was NOT invoked
```

There are two kinds:
- **Adherence probes** (`command:` or `edit:`) check that an instruction is followed. `edit:` is a regular expression over the paths the agent tried to write.
- **Trigger probes** (`skill:`) check that a skill's description makes the agent pick it, and that it stays out of the way otherwise.

Unit IDs are the ones `ctxlock scan` prints. Every probe needs exactly one of `command`, `edit` and `skill`. A pattern that is not a valid regular expression, a duplicate `id`, or an unknown key stops the check with exit 2, naming the file and the probe, before any run.

**Choose what the probe checks with care.** If the agent would do the right thing without your context, the probe shows no difference and reads as "this context does nothing". In ctxlock's own checks, naming `ruff` for Python linting changed nothing, because the model already uses ruff; naming `uv`, `pnpm`, `bun` or `just` changed the command in every run. `ctxlock probe draft` (below) throws away probes that pass without the unit.

## Drafting probes

Writing probes by hand works, and so does asking Claude to draft them:

```sh
ctxlock probe draft --unit instructions/AGENTS.md
ctxlock probe draft --unit skill/.claude/skills/release --count 4
```

ctxlock sends the unit's text to Claude with every tool switched off and asks for `--count` candidates: tasks where the unit decides the right command, or, for a skill, tasks that should and should not invoke it. It then runs each candidate itself, `--runs` times (default 2):

- **An adherence probe** runs in a copy of the working tree and in the same copy with the unit deleted. It is kept only if every run with the unit passes and no run without it does. A probe that passes without the unit tests nothing, like the `ruff` example above, and is discarded with `passes without the unit too (D36)`.
- **A trigger probe** runs in the copy with the unit. It is kept only if every run did what it expects.

A candidate whose id another probe already uses is discarded before it runs, since two probes with one id stop every `eval`. The list of kept and discarded candidates is printed with control characters replaced by `?`, because the ids and reasons are the model's text.

The kept probes are written to `evals/probes/<unit>.yaml`, or `--out`, under a comment that names the unit and its digest. ctxlock never writes over an existing file, and writes nothing when no probe was kept. **Review the file before you commit it:** probes are tests, so a drafted one is checked once by a person, like any test.

| Option | Default | Meaning |
|---|---|---|
| `--unit <id>` | (required) | The unit, as `ctxlock scan` lists it |
| `--count <n>` | 4 | Candidates to ask for |
| `--runs <n>` | 2 | Runs per copy when checking each candidate |
| `--max-runs <n>` | 24 | The most checking runs; candidates past it are discarded with `run budget` |
| `--model`, `--claude`, `--workdir` | as for `eval` | |
| `--out <path>` | `evals/probes/<unit>.yaml` | The file to write, relative to the repository |

## Running it

```sh
ctxlock eval --base origin/main          # the working tree against origin/main
ctxlock eval --base origin/main --head HEAD --format markdown
```

| Option | Default | Meaning |
|---|---|---|
| `--base <ref>` | (required) | The ref to compare against |
| `--head <ref>` | the working tree | The ref to check |
| `--format` | `text` | `text`, `json` or `markdown` |
| `--runs <n>` | `eval.runs`, or 3 | Runs per arm |
| `--max-runs <n>` | `eval.max-runs`, or 24 | The most runs one check may start |
| `--max-minutes <n>` | `eval.max-minutes`, or 20 | No run starts after this many minutes |
| `--model <model>` | `eval.model`, or `sonnet` | The model Claude Code runs. The report names the model each run actually used |
| `--claude <path>` | `claude` on `PATH` | Claude Code's executable |
| `--workdir <dir>` | `$RUNNER_TEMP`, or the system temp folder | Where the run folders and the cache go |
| `--cache <dir>` | `ctxlock` in your cache folder: `$XDG_CACHE_HOME`, else `~/.cache`, or `~/AppData/Local` on Windows | Where results from git refs are cached. Not a temp folder by default: on a machine other users share, they could plant results there |
| `--all` | off | Run every probe, not only those on changed units |
| `--keep-runs` | off | Keep the run folders, with each transcript, to see why a probe failed |
| `--fail-on-regression` | off | Exit 1 on a gated regression (below) |

Settings come from the **base** branch's `ctxlock.yaml`, like `diff`'s, so a pull request cannot shrink the check that judges it:

```yaml
eval:
  model: claude-sonnet-5-5
  runs: 3
  max-runs: 24
  max-minutes: 20
```

## What runs, and what cannot

A probe runs only when the unit it names changed between the two refs; `--all` runs them all. For each probe, ctxlock runs Claude Code headless (`claude -p`) `runs` times in each arm, alternating base and head:

- **Each arm is a copy** of the repository at that ref, in a fresh folder under `--workdir`. Links become plain files, and links that leave the repository are dropped. So is any file whose path would land outside the copy, such as a Windows path with `..\` in it. A working-tree head leaves out a gitignored `CLAUDE.local.md`, which the base cannot have; `probe draft` leaves it out too.
- **Execution config is removed from the copy**: `.claude/settings.json` and `.claude/settings.local.json` at any depth and in any letter case, `.mcp.json`, and any `hooks:`, `allowed-tools:` or YAML merge key (`<<:`) in the frontmatter of a markdown file under `.claude/`. Frontmatter ctxlock cannot parse that mentions one of those keys is removed whole. The report lists what was removed. No hook, MCP server or key helper from the repository runs, and no skill grants itself a tool.
- **Nothing the agent tries is executed.** A hook that ctxlock writes next to each run denies every `Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` call, and records what it would have done. `Read`, `Glob` and `Grep` are allowed only inside the copy; a path that starts with `~` is outside, and every alternative of a brace glob such as `{src,docs}/*` must stay inside. If the hook itself fails, the call is denied. Shell commands written inline in a skill, which Claude Code runs when the skill loads rather than as a tool call, are switched off. No other tool is available: no web access, no subagents, no MCP.
- **Nothing outside the copy loads.** ctxlock excludes every `CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules` above the run folder, and refuses to run below an `AGENTS.md` or a `.claude/skills` folder it cannot exclude. Pass `--workdir` to run somewhere else.
- **A run that gets past these anyway stops the check** with exit 2: one that changes the copy, or one that made a tool call the hook never saw.

**What leaves your machine.** Running `ctxlock eval` sends the repository's context, the files the agent reads, and the probe prompt to Anthropic's API through Claude Code, under your Claude account or API key. Claude Code's non-essential traffic (telemetry, error reports, update checks) is switched off for these runs. ctxlock's own output carries counts, statuses, unit IDs and probe definitions only, never what the agent tried or replied.

## Reading the result

This is real output, from a pull request to [katanemo/plano](https://github.com/katanemo/plano) that changes its `CLAUDE.md` from `npm run typecheck` to `pnpm typecheck`, checked with a probe that expects npm:

```
ctxlock eval · Claude Code 2.1.292 · model claude-sonnet-5-5 · 3 runs per arm

  typecheck-with-npm  instructions/CLAUDE.md  base 3/3  head 0/3  regressed

Gated regressions: typecheck-with-npm

Cost: 6 runs (0 cached) · 53s · $0.10 notional on a subscription · 7-day usage window 60% → 60%
```

The agent followed the changed line in every head run, even though the repository's `package-lock.json` still says npm. The markdown version, which the Action posts, adds the intervals, whether the agent loaded the changed file (`instructions/CLAUDE.md` loaded in 3/3 head runs), and the input tokens per run (25,212 → 25,273).

| Status | Meaning |
|---|---|
| `improved` | The head's pass rate is at least 0.5 above the base's |
| `regressed` | At least 0.5 below |
| `unchanged` | Anything closer |
| `inconclusive` | Fewer than 2 valid runs in an arm, or the time budget cut the probe short |
| `not run` | The run or time budget ran out first |

A run that fails, because Claude Code is logged out, rate-limited or timed out, counts as an error, not as a fail. The report gives each arm's 95% interval (Wilson). With 3 runs, a 3 of 3 arm's interval still reaches down to 0.44: probes find large effects, such as a command that changed in every run, not small ones.

**Did the agent see the change?** For each probe, the report says in how many head runs Claude Code loaded the probe's unit. Claude Code reports most loads through its `InstructionsLoaded` hook. It does not report an `AGENTS.md` it reads because the project has no `CLAUDE.md`, though the agent follows it, so those loads are marked *predicted*.

**The gate** (`--fail-on-regression`). A probe fails it when every base run passed and no head run did, with at least 3 valid runs in each arm, and the time budget did not cut it short. At 3 against 3 that is a one-sided Fisher p of 0.05, the strongest result 3 runs can give. Probes the pull request adds never gate; the base's definition of a probe is the one that runs, and the report says when the pull request edits it. If the pull request breaks its own probe files, the report says which, and the base's probes still run.

**The cache.** Results from a git ref are cached by its tree, the probe, the model, Claude Code's version and ctxlock's, under `--cache`. On your machine, a base you check against again is not run again. Runs that failed are not cached, and a cache file that is torn or not ctxlock's is a miss: the arm runs again and replaces it. In the Action, the cache lasts for one pull request (see [its page](github-action.md#the-behavioral-check)). The working tree is never cached.

## On Windows

ctxlock starts Claude Code without a shell, because prompts come from repository files. The native installer's `claude.exe` works as is. An npm install puts only a `claude.cmd` wrapper on `PATH`, which cannot start that way; pass the executable inside the package instead:

```sh
ctxlock eval --base origin/main --claude "$(npm root -g)/@anthropic-ai/claude-code/bin/claude.exe"
```
