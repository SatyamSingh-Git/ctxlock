# 6. The second batch: the rules, the commands, and a review that broke two of them

Tasks 6–12 of [the plan](../docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md), built test-first on `main` over one long session. Each task was pushed once `npm run ci` was green, and GitHub ran it again on Ubuntu and Windows. A fresh reviewer then read Tasks 6–10.

## What exists now

| Task | What it does | Where |
|---|---|---|
| 6 | The lint framework (severity overrides, ignore globs), the Agent Skills spec check, and the hidden-text rules | `src/lint/run.ts`, `l0-*.ts`, `l1-*.ts` |
| 7 | An inventory of every hook, MCP server, command, environment variable, auto-approval and plugin in Claude Code, Codex and VS Code config, each with a fingerprint; risky instructions such as `curl … \| bash` | `l2-exec.ts` |
| 8 | Budgets for the Codex chain and skill catalog, Claude Code's on-demand cap and listing entries, and Devin's file limit; the always-on instruction count; skill length | `l3-budget.ts`, `l5-instructions.ts`, `l6-skill-length.ts` |
| 9 | Repository overviews, look-alike and drifted skills, excessive procedure | `l4-discoverable.ts`, `l7-duplicates.ts`, `l8-procedure.ts` |
| 10 | Stale paths, scripts and review dates; owners; files only some agents reach; `AGENTS.md` files Claude Code ignores | `l9-stale.ts`, `l10-owner.ts`, `l11-coverage.ts`, `l13-shadowed.ts` |
| 11 | `ctxlock scan`, `lint` and `budget`, as text or JSON, with an optional agnix adapter | `src/cli.ts`, `src/scan.ts`, `src/report/render.ts` |
| 12 | `ctxlock diff` between two refs, and the markdown the pull request comment will use | `src/diff.ts`, `src/report/markdown.ts` |

238 tests, up from 89. There are about 290 mutations across the seven tasks and the fix pass, each one a deliberate break that some test had to catch. ctxlock can now be run, from source. [The guide's commands page](../the-guide/commands.md) shows real output, and [the rules page](../the-guide/rules.md) has a real example for every group of rules.

## What worked

**Reading the vendors' source, not the plan's list of keys.** Task 7's brief named one VS Code setting, `chat.tools.autoApprove`. VS Code's source at a pinned commit showed three things:
- The key has been renamed.
- The new key is machine-scoped, so a repository cannot set it at all.
- The settings a repository *can* use to auto-approve terminal commands and URLs were missing from the plan.

The same pass found more:
- Codex strips `openai_base_url` and `notify` from project config, so listing them would only be noise.
- Codex's `[hooks]` table holds a `state` entry that is not an event.
- VS Code applies whatever it could read around a syntax error. A rule that gave up on a file that does not parse would let one planted comma hide an auto-approve rule.

**Asking what a hostile pull request would do.** That question produced most of the design of `ctxlock diff` (decision D30):
- The pull request is judged with the base branch's settings, so it cannot add `L1-hidden-unicode: off` alongside the hidden text.
- Repository text in the comment is always shown as code, so a file can't use the comment to notify a GitHub user, hide text, or load images.
- Fingerprints are hashes, so a token in `env` never reaches a comment.

**Mutation checks found code with nothing to do, not just weak tests.** Three surviving mutations turned out to be guards that could never change a result: a `union > 0` check, a harness-count check in L11, and a test for `~` that the first-folder rule already covered. They were deleted, not tested. One predicted test value, "4 findings resolved", came out as 5. The fifth was L10's message changing from "(1 unit)" to "(4 units)" between commits, which `diff` would have reported on every pull request in an unowned repository.

## What broke

See [mistakes.md](mistakes.md) for each in full.
- **The markdown scanner was hand-written,** and the review found two ways past it. It is now a real CommonMark parser.
- **An allowlist exception had room in it:** the subdivision-flag exception could carry seven hidden letters per flag.
- **Shell edits on Windows silently did nothing** several times. A grep afterwards caught each one.

## The review

A fresh reviewer read Tasks 6–10 with no knowledge of how they were built. It compiled the code into a scratch folder and checked markdown against GitHub's own renderer. It also ran the linter, read-only, on a real repository on this machine. Verdict: **ready with fixes**: no critical findings, nine important, thirteen minor. Its sharpest observation: on that real repository, 7 of the 8 `must` and `should` findings were false positives, or intended hits on a framework's own generated markers.

**Security:**
- Two ways to hide an HTML comment, both confirmed against GitHub's renderer.
- A byte-order mark, which Windows PowerShell writes, hid a whole settings file from the hook inventory.
- The environment-variable inventory missed `NODE_OPTIONS`, `LD_PRELOAD` and `PATH`, which run code as surely as `BASH_ENV`. The inventory now lists every variable.
- A minor finding was re-graded to important: chained flags could smuggle a sentence.

**False positives** that would make a team switch the tool off:
- `pnpm instead of npm` in a sentence was read as a script.
- `origin/main` and `/etc/hosts` were read as missing files.
- Six packages with a `test` skill each gave 15 "diverged copies" findings.
- A 12-character file with a byte-order mark was "capped at 40,000 characters".
- The L13 fix for a nested `AGENTS.md` would have loaded it in every session.

**One judgement call it left for Satyam:** the stock Next.js `AGENTS.md` contains `<!-- BEGIN:nextjs-agent-rules -->` markers, which failed as `must`. It was ruled on so work could continue: one-line markers and lint directives that match a strict grammar are now `info`. It is listed in the ledger, so Satyam can reverse it.

All important findings were fixed in one pass. Each fix was proven by a test that failed first, and the fix pass was mutation-checked (27 of 27 caught). The fix itself caused one regression: a skill's missing `scripts/` folder was no longer reported. Running the guide's examples again caught it, and it was fixed test-first like the rest. Eleven minor findings are recorded with their cost, and so are the reviewer's "declined to judge" items.

## What was learned

- **For a security check, the renderer is the specification.** "Is this comment visible?" has one correct answer, GitHub's, and only a real parser gives it. Reuse-over-invention matters most exactly where the code looks too small to need a library.
- **An exception should list cases, not describe a shape.** Room for "1–7 letters" is room for a message.
- **A tool people will switch off protects nothing.** The review weighed false positives as heavily as bypasses, and it was right to. The rules now skip what they can't verify, such as bare `pnpm X` or paths in folders that don't exist, rather than guess.
- **Run the examples again after a fix.** The regression from the fix pass showed up in the guide's own demo before any test caught it.
