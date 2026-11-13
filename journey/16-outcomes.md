# 16. Outcomes: whether a fix held, and the numbers that compound

[Plan 9](../docs/superpowers/plans/2026-11-13-ctxlock-outcomes.md) is Phase 3's last plan. Plan 7 found the moments a unit was in context when the person stopped or corrected the agent, and Plan 8 turned one into a fix checked by replay. This plan answers what happened after: did the fix ship, did it hold, and what does the loop add up to? Satyam's instruction, on 2026-11-13, was "continue the work", so the open calls, D89 to D95, are mine, and are marked so.

## What exists now

- **`ctxlock outcomes`:**
  - **What ships a fix:** a fix ships with the commit that adds its `miss-` probe (D90). Git holds the record; ctxlock keeps none.
  - **Durability:** each fix is judged at 7 and 30 days from the sessions that loaded one of its versions (D91).
  - **Counters:** helpful and harmful sessions, per unit and per version loaded (D92).
  - **The numbers:** time to fix, regression rate, durability at 30 days, fixes × consumers, and units never loaded, each with what it was counted over (D93).
- **`ctxlock verify`** re-checks a unit by its own probes when its `stale-after` passes, and prints the `ctxlock.yaml` lines to set. `outcomes --verify` runs each fix's probe the same way (D94).
- **Under them:**
  - **`runProbes`** runs one side only, with `arms: ['head']`.
  - **Each session load** keeps the digest the collector recorded.
  - **`locksAt`** is shared by `impact --locks` and `outcomes --locks`.
- **The suite** has 695 tests.

## What worked

**The exit demo, end to end** ([report](../docs/dogfood/2026-11-13-outcomes.md)): a planted miss in an org repository, and two consumers that take its rule.
- **Find and diagnose:** `misses` found the miss, and `diagnose` validated a fix with real Claude Code, base 0/2 to head 2/2.
- **Ship:** the proposal's diff and probe were committed.
- **Reach:** both consumers synced the fix.
- **Result:** `outcomes` found the fix 1 minute 52 seconds after the signal, with 2 consumers reached, and `verify` held 3 of 3.

The commands took 54 seconds in all. The commit happened to be made at +05:30, and the time to fix came out right, as an instant.

**Letting git be the record.** A fix and its probe travel in one commit, so finding the commit that first added the probe's id is enough to say when the fix shipped. It also says what the unit was then, and what it has been since. There is no state to keep in sync and nothing to corrupt.

**Mutation checks, task by task:**

| Task | Killed | Survivors first |
|---|---|---|
| Shipped fixes from git | 9 of 9 | none |
| Durability and the counters | 16 of 16 | 3: a session before the ship, a signal after the window, a first load with no digest |
| The numbers and the command | 15 of 15 | 3: signals only after the ship, an even median, a count equal to its inverse |
| `verify` and head-only runs | 16 of 16 | 2: a head-only run read as cut short, the YAML lines for a failing unit |
| The live run's fix | 4 of 4 | none |

Each survivor got a test, and the mutants were run again.

## What broke

- **The demo's fix printed as "0.0 days."** It shipped in two minutes, and the number hid it. A loop whose goal is a fast fix can't round the fast ones to zero. Times under a day now read in hours or minutes.
- **Git writes a UTC offset as `Z`.** The first tests expected `+00:00` back from `%cI`. The code was right; the tests were fixed.
- **The final review found six ways `outcomes` would have told a person something wrong,** each in ordinary use:
  - run from a subfolder, it found no fix at all;
  - a branch merged in from before the fix counted as having it;
  - after Claude Code's 30-day transcript cleanup, a fix that missed again would read as held;
  - a session the person corrected counted as helpful;
  - a regression at 30 days was left out of the rate;
  - a second fix to the same unit would take the first one's probe id.

  The tests passed throughout: each case was one the tests didn't hold. Two of them came from test data in a shape real input never has. All six were fixed test-first.
- **The scratchpad was cleared overnight,** the mutation script with it. It was written again from what it had been, so the same checks still apply: the baseline must pass, and a mutant equal to the code counts as survived.
- **Shell strings, again.** A script that edited a test through a heredoc had its `\n` turned into newlines. It was redone with the Edit tool.

## What was learned

- **The loop's exit can be shown, and not yet measured.** Every part runs on one chain, but the miss was planted. Real numbers wait for real misses joined to real units, which the author's own repositories don't have yet.
- **A window that hasn't closed must say so.** On the day a fix ships, both windows are pending. The output says how they stand so far and never calls them held.
- **The collector's digest matters more than it seemed.** Durability compares the bytes a session loaded. A load without a digest is never judged, so a collector that can't hash a file makes a fix's outcome unknowable.
