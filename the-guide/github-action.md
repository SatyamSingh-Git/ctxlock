# The GitHub Action

Runs [`ctxlock diff`](commands.md#ctxlock-diff) on every pull request. It shows the result in the job summary and in one pull request comment, which is updated on each push. The check fails when the pull request adds a `must` finding or an execution-affecting change.

> **Status:** the Action is built, and each of its steps has been run locally with simulated GitHub variables: a clean diff, a missing base, and a base the clone doesn't have. It has not run on a live pull request yet. Until there is a release tag, use `@main`.

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

The Action builds ctxlock from its own source on the runner (Node 22, `npm ci`, `npm run build`), then reads your checkout. It never writes to your repository, and nothing it reads is sent anywhere. The pull request comment is the only thing it posts.

## Inputs and output

| Input | Default | Meaning |
|---|---|---|
| `base` | `github.event.pull_request.base.sha` | The ref to compare against. On events other than `pull_request`, pass one, for example `origin/main` |
| `fail-on-must` | `'true'` | `'false'` reports without failing the check |
| `comment` | `'true'` | `'false'` skips the pull request comment |

| Output | Meaning |
|---|---|
| `exit-code` | `0` clean, `1` must-fix issues, `2` could not run |

## What fails the check

- **A new `must` finding:** hidden Unicode, a hidden HTML comment, a skill whose frontmatter agents cannot load. See [rules.md](rules.md).
- **An execution-affecting change:** a hook, MCP server, command setting, environment variable, auto-approval or plugin that is new or changed. Reordering or reformatting a settings file is not a change.
- **ctxlock could not run:** a missing base ref, or an invalid `ctxlock.yaml`. The job summary says which.

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
- a before → after budget table;
- the new findings by severity;
- the execution-affecting changes;
- a count of resolved findings.

Every path and message from your repository is shown as code, so a file cannot use the comment to notify someone with `@name`, hide text, or load images.

## Pull requests from forks

GitHub gives workflows on fork pull requests a read-only token, so the comment cannot be posted. That step is allowed to fail, and the result is still in the job summary and the check status. `pull_request_target` would give the job a write token, but it also gives it your repository's secrets next to the fork's files. GitHub's security guidance advises against combining it with a checkout of the pull request. ctxlock never runs the files it reads, but other steps in the same job might.
