# 17. The rest of the signals, and taking a unit out

[Plan 10](../docs/superpowers/plans/2026-11-21-ctxlock-loop-signals.md) takes on what Phase 3's list still asked for that real data could support. Satyam's instruction, on 2026-11-21, was "continue the work", so the open calls, D96 to D99, are mine.

## What exists now

- **An abandoned session is a signal** (D97): a typed session that ended with the agent stopped, in the middle of a tool, or unanswered, and quiet for an hour since.
- **A search that found nothing is evidence in a signal's turn** (D96). The diagnosis prompt says "found nothing" after it.
- **`diagnose --ablate`** replays the miss's probe with the unit taken out, and says whether the unit itself causes the miss, doesn't drive it, or helps (D98).
- **The overlay reader** can take files and folders out, not only add them.
- **The kinds of signal** are written in one place, not three.
- **The suite** has 709 tests.

## What worked

**Reading the data before the plan, again.** A scan of the author's 41 typed sessions, and their 41,728 tool results, decided two things before any code:
- **Searches that find nothing:** 142 of them, almost all Grep. As a signal they would drown the rest, so they became evidence instead.
- **Abandonment:** 2 of the 41 sessions ended so. Rare enough to be worth a signal.
- **Clustering was put off for the same reason:** fewer than ten real signals, so nothing to check a grouping against.

**Ablation earned its place on its first live run.**
- **The verdict:** Claude called the planted rule a defect.
- **The replay:** the fix validated.
- **The ablation:** taking the rule out changed nothing. The agent used npm without it too. The miss was the agent's default, which the rule failed to correct, so it was closer to a gap.

**The cross-check, again.** An independent scan of every transcript found 2 abandoned sessions. `misses` found the one the collector had recorded, at the same millisecond.

**Mutation checks:**

| Task | Killed | Survivors first |
|---|---|---|
| Searches that found nothing | 9 of 9 | 3: an MCP image, an empty Grep string, Glob's "No files found" |
| Abandoned sessions | 9 of 9 | 1: the prompt's words for an abandoned moment |
| Ablation | 11 of 11 | 1: a file added inside a removed folder |

## What broke

- **A test written against the real clock.**
  - **The test:** Plan 9's `outcomes` CLI test expected a 7-day window to be pending, for a fixture "shipped" on 2026-11-11.
  - **What happened:** on 2026-11-18 the window closed, and CI went red on the next push, which was this plan's first.
  - **The fix:** the test now expects the closed window, which stays true.
  - **The lesson:** a test that compares a fixed date with now has a fuse on it.
- **The final review caught the ablation text overclaiming.** "Taking it out changes nothing: the unit does not drive the miss" printed even when the miss hadn't happened with the unit in place, which says nothing either way. It also caught a `/compact` followed by closing the session reading as abandoned. Both were fixed test-first. Its six minors were fixed the same day, one commit each (032aecf..ac3cca2). Two changed behaviour beyond what the review asked: `--ablate` now reuses the replay's base instead of running it again, so it costs `--runs` runs, not twice that; and a session waiting on a subagent counts the subagent's transcript as activity.
- **The scratchpad was cleared again with the date,** and the mutation script went with it. It now lives in `F:\ctxlock-live\tools`, outside the scratchpad.
- **Shell strings, once more:** a `sed` with `\n` in its replacement wrote real newlines into a test. It was redone with the Edit tool.

## What was learned

- **A verdict is a claim, and ablation is a test of it.** A fix can validate for a different reason than the verdict gives: here, the rule was wrong, but it was not what made the agent do the wrong thing.
- **Most of Phase 3's remaining list waits on data, not code.** Clustering, and "the right skill wasn't loaded", need more real misses than one person's repositories have. The loop is complete enough to collect them.
