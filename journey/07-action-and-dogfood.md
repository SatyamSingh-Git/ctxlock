# 7. The Action, four real repositories, and a third way past the comment rule

Tasks 13 and 14 of [the plan](../docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md), a fresh review of everything since the last one (Tasks 11–14), the first spike memo, and the start of the second. All of it was on `main` in one session. Nothing from Task 13 on has been pushed yet: Task 14 says to ask Satyam first, and the Action's live test needs a test branch, which is also Satyam's call.

## What exists now

| Work | What it does | Where |
|---|---|---|
| Task 13 | A composite GitHub Action. It builds ctxlock on the runner, runs `ctxlock diff` against the pull request's base, writes the job summary and one sticky comment, and fails the check on a new `must` finding or an execution-affecting change | `action.yml`, `.github/workflows/self-test.yml`, [the guide page](../the-guide/github-action.md) |
| Task 14 | ctxlock run on four public repositories, every finding given a verdict, and the false positives fixed | [the dogfood report](../docs/dogfood/2026-11-06-static.md), [troubleshooting](../the-guide/troubleshooting.md) |
| Review fixes | Inline code read by the CommonMark parser; repository text that cannot break out of the comment; hidden content matched by its whole content; skill hooks and `allowed-tools` in the inventory; crashes that exit 2 | `src/units/markdown.ts`, `src/report/markdown.ts`, `src/diff.ts`, `l1-hidden.ts`, `l2-exec.ts`, `src/cli.ts`, `action.yml` |
| Spike S2 | rulesync tried as the backend for `ctxlock build` | [the memo](../docs/spikes/S2-rulesync.md), `spikes/rulesync/` |
| Spike S1 | Started: the run harness and one smoke run | `spikes/runner/` |

The suite went from 238 tests to 265, and 40 more mutations were each caught by some test.

## What worked

**Real repositories.** The plan asked for three; four were run. The fourth, `getsentry/sentry`, was added because it, `vercel/next.js` and `PostHog/posthog` all make `.claude/skills` a symlink to `../.agents/skills`. Sentry was read from a blobless clone through ctxlock's git reader, so only the files ctxlock reads were downloaded. Results:
- **No `must` findings** on any of the four.
- **131 findings in all,** 33 of them false positives or duplicates.
- **18 real stale paths in sentry.** Component files had moved to a new package, and `eslint.config.ts` had become `oxlint.config.ts` when the repository changed linters. Each of those skills sends an agent to open a file that is no longer there. No unit test would have produced findings like these.

**Each false positive had a shape.** Gitignored outputs (`.artifacts/dev.log`), paths relative to a package, `src/foo/bar.py` placeholders, `.json` as a word, a `## Project Overview` heading that was one sentence about the project, a `CLAUDE.md` that is only `@AGENTS.md`, and one catalog reported at six sites. Each got a rule fix and a test that failed first. What could not be fixed from the text alone was left alone. Examples: a file in another repository, or a branch name that looks like a path. The decision is D31, and its cost, false negatives, is D32.

**Reading the installed binary.** Twice a question about Claude Code's behaviour was settled by reading Claude Code 2.1.292 itself rather than guessing:
- Skill frontmatter `hooks` use the same schema as settings hooks, and `allowed-tools` takes a string or a list. That decided how the review's skill-hooks finding was fixed.
- A built-in plugin, `cc-plugin-agents-md`, is what makes Claude Code read `AGENTS.md`. Its help text, *"a project with no CLAUDE.md of its own gets its AGENTS.md files instead"*, matches what ctxlock already predicts. That confirmed sentry's two `L13` findings.

## What broke

See [mistakes.md](mistakes.md) for each in full.
- **The comment rule had a third way past it.** Batch 2 moved code-block detection to a CommonMark parser, but inline code was still a line-based regex. `` \`<!-- … -->\` `` renders as a hidden comment between two literal backticks, and the regex called it code. The fix takes inline spans from the parser's own `backticks` rule, positions included.
- **Numbers written from memory.** The first draft of the dogfood report had four counts wrong. Recounting from the saved output before the commit caught all four.
- **Shell escapes, again.** A Node script fed through a heredoc lost its backslashes, twice. Both times the script's own not-found guard, or the parser, stopped it before it changed anything.

## The review

A fresh reviewer read Tasks 11–14 and the previous fix pass, which no one but its author had read. The first attempt was cut off by a network error and was resumed. Verdict: **with fixes**: one critical, four important, six minor. Review Focus 1, a shallow clone, held. Each finding came with a script that reproduced it.

**The pull request check could be passed:**
- **Critical:** a comment between escaped backticks hid from the `must` rule.
- **Edits to known findings went unnoticed.** A hidden comment already on the base could be rewritten past the 60 characters its message quotes, and it still matched the old finding. A hidden-character run could grow from 2 to 500 the same way. Findings about hidden content now carry a fingerprint of all of it.
- **Skill hooks were missed.** A skill could add its own hooks and `allowed-tools`, and the inventory never looked. It does now. Subagent and command files still are not read, and the docs say so.
- **Exit codes were wrong.** A crash exited 1, which means "must-fix", and an out-of-memory exit passed the check. Now every error exits 2, and the Action fails on anything but 0 or 1.

**The comment could be used to inject markdown.** A YAML error message, an MCP server name with blank lines, a file name with a newline, or ctxlock's own error output pasted into a fence could end the code span and put a live `@mention` or image in the comment. Line breaks are now folded to spaces, and stderr never goes into the comment.

**One minor was re-graded to important.** Setting the inventory rule to `off`, a natural way to quiet its `info` noise, silently switched off the `must` gate on new hooks. Now only `L2-exec-config-changed` controls the gate.

Every fix was proven by a test that failed first, and the fix pass was mutation-checked. One mutant survived at first, and it showed a test that checked only one direction. The other five minors, the "declined to judge" items and their rulings are in the ledger.

## Spike S2: rulesync

rulesync 43.6.2 (MIT) imported the fixture and generated Claude Code, Codex, Copilot and Cursor files through a typed library API. Its `check` mode noticed a hand edit to a generated file. It does not solve what ctxlock reports, though:
- It inlines `AGENTS.md` into `CLAUDE.md`, so `L13` still fires on output that is fine.
- It copies skills rather than linking them.
- It appends a path-scoped rule to the root `AGENTS.md` for Codex, so the rule loads everywhere.

The recommendation is an optional, exactly pinned backend for `ctxlock build`, with ctxlock deciding what goes where and checking budgets. The reason for pinning: 28 major versions in three months.

## Spike S1, started

The harness copies a fixture, writes run-scoped hooks outside the copy, and runs `claude -p`. The hooks record what loaded and deny every `Bash`, `Write` and `Edit`. The smoke run (1 of the 150-run cap) did what it should:
- the agent tried `pnpm test`, as the fixture's `AGENTS.md` says;
- the hook recorded it and denied it;
- the fixture was unchanged;
- the load events showed `CLAUDE.md` importing `AGENTS.md`.

It also found a leak: a copy inside the home folder loads `~/.claude/CLAUDE.md` as if it were a parent project's file. Every probe would have carried Satyam's personal instructions. Run copies will live outside the home folder.

## What was learned

- **Replace the whole scanner, not the half you were shown.** Batch 2 fixed the block-level bypasses with a real parser and left the inline half hand-written. The next way past was in that half.
- **Matching a finding by its message is matching by what it quotes.** Anything the message leaves out is invisible to `diff`. Findings about hidden content now carry a fingerprint of all of it.
- **A setting that quiets output must not quiet a gate.** The gate has its own setting, and that should be the only switch.
- **Real repositories find real problems.** The 18 stale paths in sentry are the case for this whole category of check, and no fixture would have produced them.
