# Spike S3: reproducing two published effects

**Date:** 2026-11-06 · **Model:** Claude Sonnet 5.5 through Claude Code 2.1.292 · **Harness:** [S1's](S1-eval-runner.md) · **Runs:** 75 (96 of the 150 allowed for S1 and S3 in all) · **Code:** [`spikes/s3/s3.mjs`](../../spikes/s3/s3.mjs)

**Question:** does ctxlock's harness see the *direction* of two results from [research/03](../../research/03-evidence-what-context-works.md), on a current Claude model, with no Docker? If it can't, per-PR probes would measure nothing.

**Answer:**
- **Adherence reproduces.** A tool named in `AGENTS.md` was used in 15 of 15 runs. Unnamed, it was used in 0 of 12, on the four tasks where the model does not already reach for it by default.
- **Index versus skill does not reproduce as a difference in correctness.** Every arm answered 15 of 15. It does show in effort: the skill route takes twice the turns.

Both results bear on what probes ctxlock should run.

## 1. Adherence (ETH Zurich)

**The published result:** a tool named in the context file gets used about 1.6 times per task, against under 0.01 when it is not named.

**Setup:**
- Five tasks, each a prompt where the named tool changes the right command.
- Both arms have the same `AGENTS.md`, with two generic conventions, and no `CLAUDE.md`. The head arm adds one line naming the tool.
- 3 runs per arm.
- Uses are counted in the commands the agent tried to run, which observe-and-deny captured.

| Task | Prompt | Line in the head arm | Base: runs using the tool | Head: runs using the tool |
|---|---|---|---|---|
| uv | "Add the requests library as a dependency." | Manage Python dependencies with uv | 0/3 (it edited `pyproject.toml`) | 3/3 `uv add requests` |
| pnpm | "Add zod as a dependency." | Use pnpm for every package command | 0/3 (`npm install zod`) | 3/3 `pnpm add zod` |
| bun | "Run the tests." | Use bun to run scripts and tests | 0/3 (`npm test`) | 3/3 `bun test` |
| ruff | "Lint the Python code." | Lint Python with ruff | **3/3** (`ruff check .`) | 3/3 `ruff check .` |
| just | "Build the project." | Build with `just build` | 0/3 (`node build.js`) | 3/3 `just build` |

**Uses per task:**
- Head: 1.00.
- Base: 0.27, all of it from ruff. Without ruff: 0.00.

**The direction reproduces.** ruff is the exception that explains the effect: it is now the model's own choice for Python linting, so naming it changes nothing. A probe has to name a tool the model would *not* pick by itself, or it cannot tell a context file that works from one that is ignored.

**Spread:** each cell was 0/3 or 3/3. With 3 runs, a 3/3 cell's 95% interval still reaches down to about 0.44 (Wilson), so this is a strong signal, not a precise rate.

**An observation for S4:** these arms have no `CLAUDE.md`, so Claude Code read `AGENTS.md` through its built-in fallback. The head arm plainly followed it, but **`InstructionsLoaded` did not fire in any of the 30 runs.** A load-telemetry join built on that hook will miss every `AGENTS.md` read this way, which is how Claude Code reads it in any repository without a `CLAUDE.md`.

**One run used PowerShell** rather than Bash: `Get-Content pyproject.toml; ruff check .`. On Windows, observe-and-deny needs `PowerShell` in its matcher, as [S1](S1-eval-runner.md) set it up.

## 2. Index versus skill (Vercel)

**The published result:** a compact index in `AGENTS.md` scored 100%, against 53% when the same docs sat behind a skill.

**Setup:**
- Five questions whose answers exist only in `docs/`: a retry count, a grace period, a token lifetime, an upload cap and a release codename. Each answer is checked with a pattern.
- Three arms:
  - **skill:** `.claude/skills/project-docs/SKILL.md` points at the docs;
  - **index:** a pipe-delimited topic-to-file index in `CLAUDE.md`;
  - **none:** no pointer.
- 3 runs per question per arm.

| Arm | Correct | Skill invoked | Turns, median (range) | Duration, median | Cost reported per run |
|---|---|---|---|---|---|
| skill | 15/15 | 15/15 | 4 (4–5) | 5.7 s | $0.035 |
| index | 15/15 | — | 2 (2–2) | 3.5 s | $0.030 |
| none | 15/15 | — | 2 (2–2) | 3.7 s | $0.031 |

**Correctness did not reproduce.** All arms were perfect, the no-pointer arm included. In a repository of five short docs, the agent finds the answer with one search whatever the context says. Vercel's setting was framework documentation the model knows a stale version of, where the agent has to be pointed at current docs. This fixture doesn't create that need.

**Effort did differ:**
- The skill arm took twice the turns (invoke the skill, then read the file) and about 60% longer.
- The index saved nothing over no pointer, because the search was already one step.
- The skill was invoked every time, so Vercel's other finding, skills that go unused, did not show either. This skill's description matched the questions closely.

## What this means for ctxlock's probes

- **Adherence probes work, and they are cheap.** A one-line change to a context file flipped the intended command in every run, so 3 runs per arm detect it. The per-PR default of 24 runs is plenty for effects this large. At about 6 seconds a run, it is also far inside 20 minutes.
- **Choose the named tool with care.** If the model already prefers the tool, the probe shows no effect. That is a false "this context does nothing". Probe drafts should be checked against a no-context arm before they are committed (decision D11's review step).
- **Retrieval probes need a reason to retrieve.** In a small fixture, every arm finds the answer. To compare an index with a skill, the probe needs what Vercel had: knowledge the model holds a wrong version of, or docs too many to search in one step. Until then, measure turns and time, where the skill route did cost more.
- **Load telemetry is incomplete without `AGENTS.md`.** S4 should confirm when `InstructionsLoaded` fires, and Plan 2's collector cannot rely on it alone for repositories without a `CLAUDE.md`.

## Usage

- **75 runs:** median 2 turns (up to 6), median 5.5 s for adherence and 3.5–5.7 s for the questions. The reported cost was about $0.03 per run; on a subscription this is notional.
- **No errors, no timeouts:** all 75 fixtures were unchanged.
- **The weekly usage window** read 0.57 before and after these 75 runs, in the stream's `seven_day.utilization`, which has a resolution of 0.01. So on Sonnet they took under 1% of it.
- **The default model** was not used, to protect the window. A repeat on it is the obvious next check, at a few times the cost.
