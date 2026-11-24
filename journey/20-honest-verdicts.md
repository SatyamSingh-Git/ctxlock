# 20. Verdicts that a test supports

On 2026-11-24 a review of ctxlock's risks (kept locally, not committed) gave the order of work after 0.1.0 (D117). Its headline was that ctxlock can prove flips, not lifts. Its first item was that eval's own labels overstated what 3 runs a side can show.

The old rule called a probe `improved` or `regressed` when the pass rates differed by half the runs. On unchanged context, a probe that passes some runs and not others crosses that line by chance. The review put the share of unchanged probes it would mislabel at 4–22%, depending on how steady they are.

Satyam said to update the plan toward the review. Plan 14 ([plan](../docs/superpowers/plans/2026-11-24-ctxlock-honest-verdicts.md)) is the result, and its calls are D118 to D121. It ran alongside Plan 15 (`check`, [chapter 21](21-check.md)) in the same working tree, with the files split between the two sessions.

## What exists now

- **A verdict needs an exact test (D118).** `improved` and `regressed` mean a one-sided Fisher exact test gives p ≤ 0.05 in that direction. A gap of half the runs or more without that is `uncertain`. At 3 runs a side only 3/3 against 0/3 passes.
- **Only a steady probe gates (D119).** A base probe gates when it regresses and passes at least 0.9 of its base runs. The report marks a base that passes some runs and not others `flaky on the base`, and one that fails every run `fails on the base`.
- **The report gives the difference** in pass rates with Newcombe's interval, and a footnote saying what `uncertain` means.
- **diagnose replays at 3 runs a side, at least (D120).** At 2, the best possible p is 1/6, so no fix could ever have been validated by an exact test. `--max-runs` went from 16 to 24 to keep the same probes in budget.
- **`--extend <n>` (D121)** runs an `uncertain` probe on to `n` a side and tests again on every run, within the run budget, with cached runs counted once.
- **The suite has 919 tests.** Every new line was mutation-checked; two mutants were equivalent and the code they named was removed.

## What worked

**An A/A run** ([report](../docs/dogfood/2026-11-24-honest-verdicts.md)), with the head the same as the base, so no verdict but `unchanged` is true:
- **11 probe outcomes.** The old rule would have called one of them `regressed`. The new verdicts called none.
  - **The one:** a coin-flip probe, 2/3 against 0/3 at 3 a side.
  - `--extend 10` ran it on, and at 10 a side it was 4/10 against 5/10.
- **A probe broken by the agent:** `uv-run-python-script` passed every base run on Claude Code 2.1.292. On 2.1.319 it failed every run on both sides. The agent still follows the repository's `uv run python`, but now types `cd examples/basic` first, which the probe's pattern does not allow. The new note says the probe or the base is broken, which is right. It is the drift that the review's next item is about.

**Pinning exact values from the plan.** Each p-value and interval was in the plan to four places before any code, so a wrong formula would have shown at once. None did.

## What broke, and what it taught

- **The plan disagreed with itself.** D118's text said a gap under 0.5 is `unchanged`; its own test said 10/10 against 6/10 (a 0.4 drop, p = 0.043) is `regressed`. I followed the test: the exact test decides. The gap only separates `uncertain` from `unchanged`.
- **`main` was red for one push.** Task 1 changed the verdicts, and the plan left the diagnose tests that depended on them to Task 3. I pushed Task 1, CI failed, and Task 3 went next to turn it green ([mistakes](mistakes.md#a-plan-that-left-main-red-between-tasks)).
- **The arms take turns.** The test fake could make odd runs differ, but base and head runs alternate, so all of one arm's runs are odd or all are even. No scenario could give one pass in three. The fake now takes a list of run numbers.
- **`npx` ran a stranger's package** ([mistakes](mistakes.md#npx-ran-a-package-the-project-does-not-use)).

## The final review

A fresh reviewer checked the statistics against exact rationals, 2.3 million one-sided tests with no wrong decision. It also confirmed the interval against Newcombe's own worked example. It found four things to fix, all now fixed with a test that failed first:
- **An extension took time that a later probe's first round needed.** The extension ran right after its own probe's first round. With `--max-minutes`, a later probe could go unrun, and a regression it would have gated passed. The second round now starts only after every first round.
- **An extension the time budget cut short got a full verdict**, no reason, and could gate. It now says `extension cut short` and never gates.
- **diagnose validated a fix while one of the unit's own probes went from 3/3 to 1/3.** Before Plan 14 that drop was `regressed` and blocked the fix. Under D118 it is `uncertain`, which the replay ignored. A probe that only looks worse now makes the replay inconclusive.
- **diagnose hid `not extended`**, then told the user to use `--extend`. The replay rows now give the reason, and the proposal says to raise `--max-runs`.

Nine minor findings wait, among them:
- with `--extend`, a base cached at 10 runs feeds the first round's verdict;
- the markdown "Not run" block lists a probe that ran but was not extended;
- a regressed base probe passing 0.8 to 0.9 of its base runs gets no note saying why it does not gate;
- the exact test overflows at 515 runs a side;
- D42's status still says it stands.

## What is next

The final review of the plan, then Now 2 of D117: a drift watch, so a loader or an agent version that changed is caught by ctxlock, not by a probe that happens to turn red.
