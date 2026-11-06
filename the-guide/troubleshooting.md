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

## `Claude Code not found`

`ctxlock eval` and `ctxlock probe draft` start `claude` from your `PATH`. Install Claude Code, or pass its executable with `--claude <path>`. On Windows, an npm install puts only a `claude.cmd` wrapper on the `PATH`, which ctxlock cannot start without a shell; pass `"$(npm root -g)/@anthropic-ai/claude-code/bin/claude.exe"` instead. The native installer's `claude.exe` works as is.

## `... is above the run folder and would load into every run`

Claude Code loads instructions from every folder above the one it starts in. ctxlock excludes `CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules` above its run folders, but it cannot exclude an `AGENTS.md` or a `.claude/skills` folder, so it refuses to run below one. Pass `--workdir` with a folder that has none above it. On Windows the system temp folder is under your home folder, which matters only if you keep an `AGENTS.md` there; your own `~/.claude/skills` is fine.

## `... reached Claude Code without passing the run hook` or `a run changed ... in the copy behind the hooks`

Either means a run got past ctxlock's isolation, so the check stops at once rather than run more. The first says Claude Code reported a tool call that acts, such as a `Bash` command, that ctxlock's hook never saw: a Claude Code version that runs hooks differently, or a hook that could not start. The second says a file in the copy changed while every such call was meant to be denied; it gives the number of files, not their names, since the agent chose those. Neither should happen. Run `ctxlock eval` again with `--keep-runs`, which keeps each run's `stream.jsonl` and `events.jsonl` under `--workdir`, and open an issue with them.

## A probe is `inconclusive`

An arm needs at least 2 runs that finished. Each run that failed is listed under **Errors** with Claude Code's reason: often an expired token (`claude setup-token` makes a new one), a usage limit, or a time-out. With `--runs 1` every probe is inconclusive; use it only to look at one run with `--keep-runs`.

## `probe draft` keeps nothing

Each candidate must pass every run with the unit, and, for an instruction, no run without it. On the repositories ctxlock was tried on, most candidates failed the second test: the repository already told the agent the same command, through a lockfile, a `package.json` script or a skill. That is a finding about the file, and a reason to read [L4](rules.md). You can still write a probe by hand for an instruction you expect people to change.
