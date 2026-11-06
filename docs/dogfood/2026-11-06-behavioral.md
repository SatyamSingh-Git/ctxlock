# Behavioral dogfood: probes against real Claude Code

**Date:** 2026-11-06 · **ctxlock:** `main` at `c626853`, plus the fix this pass led to (`f6f7376`) · **Claude Code:** 2.1.292, headless, on Satyam's Max subscription, `--model sonnet` (Sonnet 5.5) · **Plan:** Task 9 of [Plan 2](../superpowers/plans/2026-11-06-ctxlock-behavioral-ci.md)

`ctxlock eval` and `ctxlock probe draft` were run against real Claude Code for the first time:
- first on a fixture built to attack the isolation;
- then on three public repositories, for the design's Phase 1 exit items (a) and (b).

**Result:**
- **Isolation held on every point tested.** Nothing the agent tried ran, nothing outside the copy was read, and no instructions from above the run folder loaded. A control run showed the exclusion is what keeps them out.
- **Exit items pass in both directions.** Item (a) was checked on all three repositories and item (b) on the one whose skills Claude Code lists. Every planted edit was flagged `regressed` and failed the opt-in gate (3/3 → 0/3); every revert ran nothing and flagged nothing.
- **One real bug, fixed:** a drafting prompt with a large unit did not fit on a Windows command line.
- **Drafting is strict on real repositories:** 1 probe kept out of 9 candidates. Most instructions in these files repeat what the repository already shows.

The whole pass took 73 headless runs:
- isolation, 6;
- a control, 1;
- a stdin check, 1;
- three drafts, 39;
- a hypothesis check, 2;
- four planted-edit checks, 24.

The 32 runs whose cost ctxlock reports came to $0.81 as Claude Code reports it (notional on a subscription); `probe draft` does not print a cost. The 7-day usage window read 60% at the first run and 61% at the last.

## Isolation, against a fixture built to break it

The fixture, outside the home folder, had:
- a skill with `allowed-tools: Bash` and a `hooks:` block that writes a marker file;
- a project `.claude/settings.json` that allows every Bash command and has a `SessionStart` hook writing another marker;
- a `deploy.sh` that writes a third;
- a `CLAUDE.md` above the run folder, and a file imported from `CLAUDE.md` by absolute path, each telling the agent to run a canary command;
- a file next to the run folder holding canary text.

| Check | What happened | Verdict |
|---|---|---|
| Skill with `allowed-tools: Bash` | The agent invoked the skill, read `deploy.sh`, and tried `bash deploy.sh`. The hook denied it | The deny wins over `allowed-tools` |
| Hooks from the repository | No marker file appeared. The report listed `.claude/settings.json` and the skill's `hooks` as removed from the copies | Stripped (D38) |
| `Read` of a file outside the copy | Denied as outside the run folder; its canary text is in neither the stream nor the log | Confined (D39) |
| `CLAUDE.md` above the run folder | Not loaded, and no canary command | Excluded (D44) |
| **Control:** the same run without `claudeMdExcludes` | Claude Code loaded the ancestor `CLAUDE.md` (`session_start`), and its canary reached the stream | The exclusion is what keeps it out |
| `@<absolute path>` import from `CLAUDE.md` | Not loaded, and no canary command | Not loaded (no control run) |

6 runs plus 1 control. None of the three markers exists.

## The bug: a prompt that did not fit a command line

The first draft, on `openai/openai-agents-python`, stopped with `spawn ENAMETOOLONG`:
- **The cause:** `probe draft` put its prompt, which holds the unit's text, on the command line. This repository's `AGENTS.md` is 38,241 bytes, and Windows allows 32,767 characters for a whole command line. Node threw at 33,000 characters and not at 30,000 in a reproduction.
- **The check:** `claude -p` with no prompt argument reads its prompt from stdin; a 40,121-character prompt arrived intact in one live run.
- **The fix:** `f6f7376` sends every prompt on stdin. A test sends 40,000 characters and asserts that none of them are in the arguments.

The re-run drafted the probe used below.

## The repositories

| Repository | Commit | Context | The probe's instruction |
|---|---|---|---|
| `openai/openai-agents-python` | `d4f07df` | `AGENTS.md` (38,241 bytes), and `CLAUDE.md`, a symlink to it | "Use `uv run python ...` for Python commands" |
| `vercel-labs/skills` | `d3701c1` | `AGENTS.md` (12,210 bytes), no `CLAUDE.md`, so Claude Code reads it through its fallback | `pnpm test` in its command list |
| `katanemo/plano` | `b13ddd6` | `CLAUDE.md` (4,684 bytes) and 8 skills in `.claude/skills`, 5 of them listed | `npm run typecheck`; the `test-python` skill |

`plano` (7,110 stars, Apache-2.0, 65 MB) replaced the dogfood report's `getsentry/sentry` as the repository with skills Claude Code lists, because a probe run copies the whole tree twice. Each instruction is also backed by the repository's own lockfile (`uv.lock`, `pnpm-lock.yaml`, `package-lock.json`), so a planted edit has to win against what the repository shows.

## Drafting

`ctxlock probe draft --count 3 --runs 2`, 13 runs per repository:

| Repository | Kept | Discarded |
|---|---|---|
| `openai-agents-python` | `uv-run-python-script` | 2 that did not pass every run with the unit |
| `skills` | none | 2 that did not pass every run with the unit; 1 that passed without it (D36): `pnpm api:update`, which the agent finds in `package.json` |
| `plano` | none | 3 that passed without the unit (D36): with `CLAUDE.md` deleted, its listed skills (`build-wasm`, `check`, `test-python`) still told the agent the same commands |

That is the research's finding (research/03) showing up in a check: most of what these files tell the agent is already in the repository. D36 throws such probes away because they cannot show that the file does anything. Where nothing was kept, the probes below were written by hand and reviewed once.

Why two candidates per repository failed even with the unit is open: `probe draft` deletes its run folders, so their transcripts were not kept. One check of a hand-written probe on `skills` ("Run the end-to-end tests.") passed 1/1 in each arm, so the agent stopping after its first denied command does not explain it.

## Exit items (a) and (b), both directions

Each check:
1. committed the probe as the base;
2. planted the edit as the next commit, and ran `ctxlock eval --base <base> --head <planted>`;
3. reverted the edit, and ran `ctxlock eval --base <base> --head <revert>`.

3 runs per arm.

| Item | Repository | Planted edit | Probe | Base | Head | Result | Changed unit loaded (head) | Revert |
|---|---|---|---|---|---|---|---|---|
| (a) | `openai-agents-python` | Both lines saying `uv run` now say `python3 ...` directly | `uv-run-python-script` (drafted) | 3/3 | 0/3 | regressed, gated | 3/3, observed | nothing ran |
| (a) | `skills` | `pnpm test` → `bun test`, with a note that the tests moved to bun | `tests-use-pnpm` | 3/3 | 0/3 | regressed, gated | 3/3, **predicted**: read through the fallback, so no event (D37) | nothing ran |
| (a) | `plano` | `npm run build && npm run lint && npm run typecheck` → `pnpm …` | `typecheck-with-npm` | 3/3 | 0/3 | regressed, gated | 3/3, observed | nothing ran |
| (b) | `plano` | `test-python`'s description now says it formats Rust code | `python-tests-skill` | 3/3 | 0/3 | regressed, gated | 3/3 listed | nothing ran |

In (b), triggering the skill shows in effort too: the base runs that invoked it took 4 turns and 38,134 input tokens, and the head runs 2 turns and 25,236.

### Cost per check

| Check | Runs | Time | Cost reported |
|---|---|---|---|
| `openai-agents-python` (a) | 6 | 77 s | $0.21 |
| `skills` (a) | 6 | 59 s | $0.13 |
| `plano` (a) | 6 | 53 s | $0.10 |
| `plano` (b) | 6 | 64 s | $0.12 |
| Each revert | 0 | 0–6 s | $0 |

## What this changes

- **The design's Phase 1 exit items (a) and (b) are met:** (a) on three public repositories, (b) on the one with skills Claude Code lists, each with probes that show a change in every run.
- **The fallback prediction earns its place.** On `skills`, Claude Code reported no load at all, yet the agent followed the edited `AGENTS.md` in every run. Without D37's prediction the report would say the agent never saw the change.
- **Isolation is now checked live**, not only against the stand-in for Claude Code in the test suite.
- **Drafting needs a way to see why a candidate failed.** `probe draft` should keep its run folders on request, as `eval --keep-runs` does. Left for the next plan.
- **D36 may be too strict for probes that guard against regressions.** A probe that passes without the unit cannot show that the file helps. It can still catch an edit that changes what the file says, as the hand-written `plano` probe did although `CLAUDE.md` only repeats a lockfile. Whether `probe draft` should keep such probes, labelled, is a question for Satyam.
