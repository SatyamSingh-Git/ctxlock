# Troubleshooting

What goes wrong, why, and the fix. Each entry comes from something that happened while ctxlock was built or run on real repositories ([the dogfood report](../docs/dogfood/2026-11-06-static.md)). If you hit something that is not here, please [open an issue](https://github.com/SatyamSingh-Git/ctxlock/issues) saying what you ran, what you expected and what you got.

## `base ref <sha> not found`

```
base ref 3f2a9c1 not found — in GitHub Actions use actions/checkout with fetch-depth: 0
```

`ctxlock diff` reads the base commit from git, and `actions/checkout` clones only the latest commit unless told otherwise. Add `fetch-depth: 0` to the checkout step ([github-action.md](github-action.md)). Locally, the same error means the ref is not in your clone: `git fetch origin main`, then pass `--base origin/main`.

## `ctxlock diff: <dir> is not inside a git repository`

`ctxlock diff` compares two commits, so it needs a git repository, and exits 2 without one. `scan`, `lint` and `budget` work on any folder.

## A finding that is wrong for your repository

ctxlock cannot always tell from the text what a name refers to. The dogfood pass left these, all `L9-stale`:
- a file the tool you are documenting writes in its users' projects, such as `skills-lock.json`;
- a file in another repository, such as `flagpole.yaml` in a skill about a team's config service;
- a branch name that looks like a path, such as `docs/pr-draft-summary-guidance`.

You have two options in `ctxlock.yaml` ([configuration.md](configuration.md)):

```yaml
version: 1
lint:
  severity:
    L9-stale: info        # or off
  ignore:
    - ".agents/skills/remove-option-or-flag/**"
```

`lint.ignore` drops every finding in the matching files, not just one finding, so prefer the narrowest glob. In a pull request, the check is run with the **base branch's** `ctxlock.yaml`, so a change to these settings takes effect once it is merged.

Please report the false positive too: each fixed one so far came from a real repository.

## No units, or no findings, on a repository full of skills

```
no findings
```

ctxlock checks what agents load when they work in the repository. A skill library, such as a repository with skills in `skills/` for people to install elsewhere, has nothing in the folders agents read (`.claude/skills`, `.agents/skills`), so ctxlock finds no units. Run `ctxlock scan` to see what it found. Checking a library's skills is not supported yet.

## Skills that "reach codex only"

```
info  L11-coverage  .agents/skills/deploy/SKILL.md  .agents/skills/deploy/SKILL.md reaches codex only
```

Claude Code does not read `.agents/skills`. To share one set of skills between both agents, make `.claude/skills` a symlink to it, as `vercel/next.js`, `getsentry/sentry` and `PostHog/posthog` do:

```sh
ln -s ../.agents/skills .claude/skills
```

A skill with `disable-model-invocation: true` still reaches Codex only after that: Claude Code leaves it out of the list the model picks from, and Codex ignores the field.

## Symlinks on Windows

With `core.symlinks=false`, the default on Windows, git checks a symlink out as a small text file that holds the target path: `CLAUDE.md` becomes a 9-byte file containing `AGENTS.md`. ctxlock reads symlinks from git's index rather than from the file on disk, so in a git repository it reports the same result as a Linux checkout. Outside a git repository it can only see the text file.

A symlink that leads out of the repository is never followed and gives an `L0-symlink-outside` info finding.

## `L0-encoding: <file> is not valid UTF-8`

ctxlock reads context files as UTF-8, as the agents do. A file saved as UTF-16 (some Windows editors do this) is skipped, and its other checks do not run. Re-save it as UTF-8.

## The pull request comment does not appear

- **A pull request from a fork.** GitHub gives fork pull requests a read-only token, so the comment cannot be posted. The result is still in the job summary and the check status. See [github-action.md](github-action.md#pull-requests-from-forks).
- **Missing permission.** The workflow needs `pull-requests: write`.
- **`comment: 'false'`** in the step's inputs.

## The check fails with "ctxlock could not run"

The job summary shows the reason. The usual ones:
- the base ref is missing (above);
- `ctxlock.yaml` is invalid, on the base branch or in the pull request; the message names the field. `ctxlock lint` shows the same error;
- the step ran on an event other than `pull_request` without a `base` input;
- ctxlock crashed. The summary then says `ctxlock could not run (exit <n>)`, and the reason is in the job log, under the Check context step. Please report it.

## `agnix:unavailable`

`--agnix` runs [agnix](https://github.com/agent-sh/agnix) through `npx`, which needs network access the first time. If `npx` cannot run it, ctxlock reports one `agnix:unavailable` info finding and carries on with its own checks.
