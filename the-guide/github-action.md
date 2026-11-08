# The GitHub Action

Runs [`ctxlock diff`](commands.md#ctxlock-diff) on every pull request, and, when you give it Claude credentials, [`ctxlock eval`](evals.md) too. It shows the result in the job summary and in one pull request comment, which is updated on each push. The check fails when the pull request adds a `must` finding or an execution-affecting change. The behavioral check is advisory unless you ask it to fail on a regression.

> **Status:** the Action is built, and has run on [a live pull request](https://github.com/SatyamSingh-Git/ctxlock/pull/1). There it:
> - passed a harmless change;
> - posted one comment, and updated that same comment on the next push;
> - said the behavioral section was skipped, as there were no credentials;
> - failed the check on a hidden character.
>
> Until there is a release tag, use `@main`.

## Add it to a repository

```yaml
# .github/workflows/ctxlock.yml
name: ctxlock
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: SatyamSingh-Git/ctxlock@main
```

Two lines matter:
- **`fetch-depth: 0`.** `actions/checkout` clones only the latest commit by default, and ctxlock needs the base commit to compare against. Without the history, the check stops with `base ref <sha> not found — in GitHub Actions use actions/checkout with fetch-depth: 0`.
- **`pull-requests: write`.** This lets the Action post its comment. Without it, the result appears in the job summary only.

The Action builds ctxlock from its own source on the runner (Node 22, `npm ci`, `npm run build`), then reads your checkout. Node 22 stays on the `PATH` for later steps in the same job; a step that needs another version should set it up again. It never writes to your repository, and nothing it reads is sent anywhere. The pull request comment is the only thing it posts.

## Inputs and output

| Input | Default | Meaning |
|---|---|---|
| `base` | `github.event.pull_request.base.sha` | The ref to compare against. On events other than `pull_request`, pass one, for example `origin/main` |
| `fail-on-must` | `'true'` | `'false'` reports without failing the check |
| `comment` | `'true'` | `'false'` skips the pull request comment |
| `claude_code_oauth_token` | none | A token from `claude setup-token`, from a secret. Turns on the behavioral check |
| `anthropic_api_key` | none | An Anthropic API key, from a secret. Used instead of the token when both are set |
| `eval` | `auto` | `false` never runs the behavioral check, even with credentials |
| `fail-on-regression` | `'false'` | `'true'` fails the check on a gated regression (see [evals](evals.md#reading-the-result)) |
| `claude-code-version` | `2.1.292` | The Claude Code version installed for the behavioral check |

| Output | Meaning |
|---|---|
| `exit-code` | `0` clean, `1` must-fix issues, `2` could not run, including a crash |
| `eval-exit-code` | The behavioral check: `0` done, `1` a gated regression, `2` could not run. Empty when it did not run |

## The behavioral check

With a credential, the Action installs Claude Code at `claude-code-version` and runs `ctxlock eval` against the same base. Probes run only when the pull request changes a unit a probe names, so most pull requests start no run at all.

```yaml
      - uses: SatyamSingh-Git/ctxlock@main
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

- **Which credential.** `claude setup-token` makes a one-year token tied to the subscription of whoever ran it, and runs then count against that person's usage. For a secret shared across repositories, Claude Code's documentation recommends an API key from the Claude Console. Only the credential you set is passed on: an empty `ANTHROPIC_API_KEY` would otherwise override the token.
- **What it costs.** By default, 3 runs per arm, at most 24 runs and 20 minutes per check. One probe is 6 runs, and a short probe takes a few seconds each. The comment ends with the runs, the time, the cost Claude Code reports, and the 7-day usage window before and after.
- **The cache.** Base results are cached with `actions/cache` under the base commit, so pushing to a pull request again does not re-run its base arm while the base stays the same. GitHub keeps each pull request's caches to that pull request, so two pull requests do not share them.
- **What is sent to Anthropic.** The repository's context, the files the agent reads, and the probe prompts, through Claude Code. What the agent tried to do never reaches the comment, the summary or the log.
- **When it cannot run,** for example with an expired token, the comment says so, and the job shows a warning, not a failure.

## What fails the check

- **A new `must` finding:** hidden Unicode, a hidden HTML comment, a skill whose frontmatter agents cannot load. See [rules.md](rules.md).
- **An execution-affecting change:** a hook, MCP server, command setting, environment variable, auto-approval or plugin in agent config, or a hook or `allowed-tools` entry in a skill's frontmatter, that is new or changed. Reordering or reformatting a settings file is not a change. Subagent and command files (`.claude/agents/`, `.claude/commands/`) are not read yet.
- **ctxlock could not run:** a missing base ref, an invalid `ctxlock.yaml`, or a crash. Any exit code other than 0 and 1 fails the check. The job summary says which.

A `must` finding that was already on the base branch is counted in the comment but does not fail the check.

The pull request is checked with the **base branch's** `ctxlock.yaml` settings. A pull request that adds `L1-hidden-unicode: "off"` next to hidden text is still checked with the rule on, and the setting takes effect once it is merged. To accept execution-affecting changes without failing, set this on the base branch:

```yaml
lint:
  severity:
    L2-exec-config-changed: should
```

## The comment

The comment starts with `### ctxlock · context check` and a status line (`❌ 2 must-fix` or `✅ no must-fix issues`). Then it has:
- the changed units;
- what they reach, when `ctxlock.yaml` declares it ([the graph](graph.md)): the units that depend on them, the consumers that use those units, and the owners whose approval the change needs. It never fails the check;
- a before → after budget table;
- the new findings by severity;
- the execution-affecting changes;
- a count of resolved findings;
- the behavioral section, `### ctxlock · behavioral check`, when it ran: a table of probes with base and head results, whether the agent loaded the changed unit, the tokens per run, and the cost. Without credentials, a line saying it was skipped.

Every path, name, owner and message from your repository is shown as code, so a file cannot use the comment to notify someone with `@name` (not even an owner the change needs), hide text, or load images. Line breaks in that text become spaces, so it cannot end the code early. When ctxlock cannot run, the comment gives the reason the same way. If it crashed before writing anything, the comment says so and the reason is in the job log; ctxlock's error output never goes into the comment.

## Pull requests from forks

GitHub gives workflows on fork pull requests a read-only token, so the comment cannot be posted. That step is allowed to fail, and the result is still in the job summary and the check status. Fork pull requests get no secrets either, so the behavioral check is skipped, and the summary says so. `pull_request_target` would give the job a write token, but it also gives it your repository's secrets next to the fork's files. GitHub's security guidance advises against combining it with a checkout of the pull request. ctxlock never runs the files it reads, but other steps in the same job might. With the behavioral check it is worse: the fork's context would steer an agent holding your Claude credential. Use `pull_request`.
