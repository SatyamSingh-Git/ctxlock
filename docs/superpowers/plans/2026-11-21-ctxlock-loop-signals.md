# ctxlock: the rest of Phase 3's signals, and ablation replay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finish what Phase 3's list still asks for and real data can support:
- **An empty search in a turn:** a search that found nothing, kept as evidence in the turn of a signal.
- **An abandoned session:** as a signal of its own.
- **Ablation replay:** in `diagnose`, the replay with the unit taken out.

**Architecture:**
- **The transcript reader:** marks each action whose result was empty, and finds a session that ended with the agent stopped, mid-tool, or unanswered.
- **`misses`:** counts the new signal like the others.
- **`diagnose --ablate`:** runs the miss's probe a third way, with the unit's files removed through the overlay reader, so the verdict can be checked against what the unit actually does.

**Tech Stack:** TypeScript 7, Node ≥ 22 ESM, vitest, zod 4, commander. No new runtime dependency.

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md), §6 Phase 3:
- "Signals from transcripts: user corrections, relevant skill not loaded, tool returned empty, abandoned session, thumbs";
- "Counterfactual replay that ablates or edits the top candidate units";
- "Clustering, with a threshold before routing".

It builds on Plans 7–9.

Satyam asked on 2026-11-21 to "continue the work" without design questions. Every call below that the spec leaves open is mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `0251677` |
| 2 | Done | `6714525` |
| 3 | Done | `95e7eaf` |
| 4 | Done | the docs commit |

## What the real transcripts hold

Before this plan, a read-only scan of the author's 1,014 transcripts, of which 41 sessions had a typed prompt and 41,728 tool results:
- **Empty results:** these are almost all searches. Grep said "No matches found" 133 times and "No files found" 8 times, and Glob said "No files found" once.
  - The "empty" Read and ToolSearch results held images or tool references, not nothing.
  - No MCP tool returned an empty result.
- **How sessions ended:**
  - 36 on the agent's answer;
  - 2 on a typed prompt never answered;
  - 1 on an interrupt;
  - 2 mid-tool.
- **Signals:** fewer than ten across all of the author's repositories, from Plan 7.

## Rulings this plan makes (my calls)

- **D96. An empty search is evidence inside a turn, not a signal.**
  - **What counts as empty:** a Grep, Glob or MCP tool result whose text is empty or starts "No matches found" or "No files found", with no image or other block.
  - **Where it goes:** it marks that action `empty`, and the diagnosis prompt shows it as "found nothing".
  - **Why not a signal of its own:** agents search and miss all the time. As a signal it would outnumber every other kind and route noise, at 142 in 41 sessions. Next to a correction it says what the agent looked for and didn't find, which is a gap's evidence.
  - *If wrong:* a `searched` signal with its own threshold.
- **D97. A session is abandoned when its last line on the main thread is:**
  - an interrupt;
  - a tool call with no result;
  - a tool result with no answer;
  - or a typed prompt with no answer;
  - **and** that line is at least an hour old.

  The signal's kind is `abandoned`, at the last line's time. Like an interrupt, it says something went wrong, not what was wanted, so it gets a verdict and no fix (D84).
  - **Why an hour:** a session still running looks the same, and so would the one ctxlock runs in.
  - *If wrong:* a `--quiet-for` flag.
- **D98. `diagnose --ablate` replays the miss's probe a third way: with the unit's files taken out.**
  - **The comparison:** with the unit and without it, the same number of runs a side.
  - **What it says:**
    - `improved`: taking it out does what was wanted, so the unit itself causes the miss;
    - `unchanged`: the unit doesn't drive it;
    - `regressed`: the unit helps.

    This is shown beside the verdict and does not change "validated".
  - **When it runs:** only when there is a probe, since without one there's nothing to measure. A unit reached only through a link is not ablated, and says so.
  - *If wrong:* ablation without a fix, from the turn's own task as the probe.
- **D99. Clustering waits.**
  - **Why:** with fewer than ten real signals across the author's repositories, any grouping of corrections by their text could not be checked against anything.
  - **What stands in for it:** routing already groups by unit across distinct sessions, which is the spec's threshold.
  - **"Relevant skill not loaded"** waits with it, since it needs a diagnosis across sessions. **Thumbs** leave no record (D78).
  - *If wrong:* the next plan, once real signals exist.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- **Only `diagnose` sends text away, and only what D83 lists, redacted.** "Found nothing" is a fact about the action, not text from the session.
- **Nothing is written into the repository.** Ablation runs in throwaway copies, as the replay does.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push to `main` after each task and watch CI on both operating systems.

## Review Focus

1. **A session still being written:** the newest transcript, the one ctxlock runs in, is never `abandoned` (Task 2).
2. **A tool result with an image and no text:** never `empty` (Task 1).
3. **A result that follows its call after other lines, or a result for a subagent's call:** matched by `tool_use_id`, never by position (Task 1).
4. **An abandoned session that also ends on an interrupt:** counted once per unit per session, as routing does, with both kinds shown (Task 2).
5. **Ablating a skill:** its whole folder goes, `SKILL.md` and its other files, and no other unit changes (Task 3).

## Files

| File | Responsibility |
|---|---|
| `src/loop/transcript.ts` | `Action.empty`; the `abandoned` signal |
| `src/loop/misses.ts`, `src/report/misses.ts`, `src/loop/draft.ts` | the new kind, counted and shown |
| `src/loop/diagnose.ts` | "found nothing" in the prompt |
| `src/repo/overlay.ts` | files taken out |
| `src/loop/propose.ts`, `src/report/diagnose.ts`, `src/cli.ts` | `--ablate` |

---

## Final review

A fresh Opus reviewer read the whole plan's diff, and ran the built reader over all 1,014 of the author's transcripts: 2 abandoned sessions, as the report says. One Important, and one Minor re-graded to Important, were fixed test-first:
- **The ablation wording claimed a cause it hadn't shown.** "Unchanged" said the unit doesn't drive the miss even when the miss didn't happen with the unit in place, and any inconclusive run blamed a budget. It now says when the miss didn't reproduce, and names the real cause of an inconclusive run.
- **Re-graded: a manual `/compact` then closing the session made a false abandoned signal,** since the summary carries the human mark. A summary now leaves nothing unanswered.

Mutation 4/4. Suite 709/709.

**Minors** (deferred by the review, then fixed at Satyam's request, one commit each):
- Ablation has its own --max-runs and --max-minutes budget, and re-runs the base side the replay already ran; the help text doesn't say a diagnose can reach twice either (src/loop/propose.ts, src/cli.ts). **Fixed in 032aecf:** only the side without the unit runs, from what --max-runs has left; the help says --max-minutes gives it its own window.
- A main-thread Agent call that runs over an hour leaves its tool call as the session's last line, so a live session can read as abandoned (src/loop/transcript.ts). **Fixed in 70dfb0e:** the hour runs from the latest line in the session or its subagents' transcripts.
- Every MCP tool counts as a search, so an MCP write tool that returns an empty result gets "found nothing" (src/loop/transcript.ts). **Fixed in 79b4c21:** an MCP tool counts only when its own name says it looks something up.
- --ablate with no fix or probe prints nothing about ablation; the guide says it runs only when there is a probe. **Fixed in f35dc8c:** it says it was not run.
- The dogfood table shows "0 abandoned", which the text output never prints; the counts there come from the JSON. **Fixed in 9c42e1c.**
- misses --format json gains signals.abandoned, and an abandoned-only unit now routes and drafts: intended by D97, but a JSON consumer sees a new key. **Fixed in ac3cca2:** the guide describes the JSON and says the kinds may grow; ctxlock is unpublished, so no outside consumer had it.

### Task 1: An empty search, as evidence in the turn

**Files:** Modify `src/loop/transcript.ts`, `src/loop/diagnose.ts`, `tests/loop/transcript.test.ts`, `tests/loop/diagnose.test.ts`.

**Interfaces:**
- Produces: `Action { tool: string; target: string; empty?: true }`. The prompt line for an empty action is `     - <tool>: <target> (found nothing)`.

- [ ] **Step 1: Write the failing tests.**
  - `a search that found nothing marks its action empty, matched by its tool_use_id, and a result with an image or text is not empty`. It covers Review Focus 2 and 3.
  - `the diagnosis prompt says an action found nothing`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/transcript.test.ts tests/loop/diagnose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep each action's `tool_use_id` while the turn is open, and mark the action when its result arrives.
- [ ] **Step 4: Run** it. Expected: PASS. Mutation-check. **Commit** `feat: a search that found nothing is evidence in its turn`.

### Task 2: The abandoned session

**Files:** Modify `src/loop/transcript.ts`, `src/loop/misses.ts`, `src/report/misses.ts`, `src/loop/draft.ts`, `src/report/diagnose.ts`, their tests, and `tests/cli.test.ts`.

**Interfaces:**
- Produces:
  - `Signal.kind: 'interrupted' | 'correction' | 'abandoned'`;
  - `readTranscript(file, session, now = new Date())`;
  - `UnitMiss.kinds.abandoned` and `Misses.signals.abandoned`.
- **The output:** text gives "N abandoned" beside the other kinds, in `misses`, the drafts and `diagnose`.

- [ ] **Step 1: Write the failing tests.**
  - `a session that ends on an interrupt, a tool call, a tool result or an unanswered prompt, an hour or more ago, is abandoned at its last line; one that ends on an answer, or less than an hour ago, is not`. It covers Review Focus 1.
  - `an abandoned session is routed once per unit with its other signals, and its kinds say both`. It covers Review Focus 4.
  - `misses text, drafts and diagnose name abandoned sessions`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS. Mutation-check. **Commit** `feat: a session left with the agent stopped or unanswered is a signal`.

### Task 3: Ablation replay

**Files:** Modify `src/repo/overlay.ts`, `src/loop/propose.ts`, `src/report/diagnose.ts`, `src/cli.ts`, and the tests for each.

**Interfaces:**
- Produces:
  - `overlayReader(base, added, removed?: Set<string>)`. A path in `removed`, or under one, is not listed and not readable, and its link is dropped.
  - `DiagnoseOptions.ablate?: boolean`.
  - `Replay.ablation?: ProbeOutcome | { skipped: string }`.
- **The text:**
  - `Without the unit, 2 runs a side: improved` followed by the row;
  - one of three lines:
    - `Taking it out does what was wanted: the unit itself causes the miss.`
    - `Taking it out changes nothing: the unit does not drive the miss.`
    - `Taking it out makes it worse: the unit helps.`
- **The proposal:** says the same in one line.

- [ ] **Step 1: Write the failing tests.**
  - `the overlay leaves out a removed file and everything under a removed folder, and reads the rest`. It covers Review Focus 5.
  - `diagnose --ablate replays the miss probe without the unit: a rule that causes the miss is improved by its removal`, with the fake Claude.
  - `ablation is skipped, and says why, for a unit reached through a link`.
  - `the text and the proposal say what taking the unit out did`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS. Mutation-check. **Commit** `feat: diagnose --ablate replays the miss without the unit`.

### Task 4: Live runs, docs and decisions

- [ ] **Step 1: Live.**
  - **Abandoned sessions:** `misses` on the author's repositories, checked against the recon scan's endings.
  - **Ablation:** `diagnose --ablate` on the planted miss in `F:/ctxlock-live/loop`, with real Claude Code.
  - **Report:** `docs/dogfood/2026-11-21-signals.md`.
- [ ] **Step 2: Docs.**
  - **The guide:** the signals, "found nothing", and `--ablate` in `the-guide/misses.md` and `commands.md`.
  - **README:** the roadmap.
  - **The journey:** `journey/17-signals.md`, the index, and D96–D99.
- [ ] **Step 3: Run** `npm run ci`. Expected: PASS. **Commit** `docs: abandoned sessions, empty searches and ablation, the live run, and D96-D99`, push, and watch CI.
