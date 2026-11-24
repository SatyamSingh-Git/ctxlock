# ctxlock: honest eval verdicts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every word `eval` and `diagnose` print about a probe is one its runs can support.
- **`improved` and `regressed`** appear only when an exact test supports them.
- **A close result says so:** a probe that looks different without that support is `uncertain`.
- **Gating:** only probes that pass reliably on the base can gate.
- **The difference has an interval.**
- **Closer looks, opt-in:** a probe that looks different can get a second round of runs.

**Architecture:**
- **Two pure functions in `src/eval/eval.ts`,** beside `wilson`: a one-sided Fisher exact test, and a Newcombe interval for the difference in pass rates. `status()` and the gate read them.
- **The reports** say what each verdict means.
- **`diagnose`** moves to 3 runs a side, the fewest at which any difference can be shown.
- **`runProbes` gains `extendTo`.** A probe whose first result is `uncertain` keeps running, up to that many runs a side, within `--max-runs`.

**Tech Stack:** TypeScript 7, Node ≥ 22 ESM, vitest, commander. No new dependency.

**Spec:**
- D117 in [journey/decisions.md](../../../journey/decisions.md), and the design's "After 0.1.0: the order of work" section ([design §6](../specs/2026-11-05-ctxlock-design.md)).
- The design's §5.2, the eval design rules, still stand.
- The evidence is the 2026-11-24 risk review, kept outside the repository in `reports/ctxlock risks and novel answers.md`, with its notes in `research_notes/ctxlock risks and novel answers/effect_evidence_and_statistics.md`. Its figures:
  - **The current label misfires:** `|Δ| ≥ 0.5` labels an unchanged probe improved or regressed 4.1% of the time at a base rate of 0.9, 17% at 0.7 and 22% at 0.5.
  - **The current gate is sound:** 3/3 against 0/3 is a one-sided Fisher p of exactly 0.05, and the gate's real false-positive rate is about 0.016.
  - **The gate is weak:** it catches 0.9 → 0.3 only 25% of the time. A second stage to 10 runs a side raises that to 82%, at about 16 runs on average for a probe that changed.

Satyam's call on 2026-11-24 was "update the plan towards it", after the review. The calls below that D117 leaves open are mine. Each is recorded as D118 to D121.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | done | d6c0a1c |
| 2 | done | c77a1e8 |
| 3 | done, before Task 2, so main went green a push sooner | ad1a0d0 |
| 4 | done | 220c722 |
| 5 | done | this commit |

## Decisions this plan makes

- **D118. A verdict needs an exact test.**
  - `improved` and `regressed` mean a one-sided Fisher exact test in that direction gives p ≤ 0.05.
  - `uncertain` means the pass rates differ by at least 0.5 without that.
  - `unchanged` means they differ by less than 0.5, and `inconclusive` and `not-run` stay as they are.
  - At 3 runs a side, the only tables that reach p ≤ 0.05 are 3/3 against 0/3, either way. So the gate's existing behaviour is kept exactly, and only the labels change.
- **D119. Only a steady probe gates.** A base probe gates when it regresses (D118) and its base passes at least 0.9 of its valid runs. A base pass rate strictly between 0.2 and 0.8 is marked "flaky on the base: it never gates". A base probe that fails every base run is marked "fails on the base: the probe or the base context is broken, so it can only improve". pass^k is not added: at these run counts it equals "every run passed", which the ratio already shows.
- **D120. Diagnose replays at 3 runs a side, at least.** At 2 a side, the best one-sided p is 1/6, so no fix could ever be validated (D118). A miss that is `uncertain` makes the replay `inconclusive`, with "run again with more --runs".
- **D121. A second round is opt-in.** `eval --extend <n>` and `diagnose --extend <n>` run an `uncertain` probe on to n valid runs a side, within `--max-runs`. Then they test once more on every run. Cached runs count toward either round.

## Global Constraints

- **No new dependency.** The statistics are written out in TypeScript, with every value a test pins worked out exactly here.
- **What runs and reaches the agent doesn't change:** the probes, their order, the hooks, the cache key and the run budget. The only change is extra runs, under `--extend`.
- **The PR comment keeps its privacy rule:** counts, statuses, unit IDs and probe definitions only.
- **Every test is checked in both directions and mutation-checked.** Run tests from PowerShell, or from `/F/ContextFS` in Git Bash.
- **Pushing:** after each task, once `npm run ci` is green. Add files by name, `git fetch`, and push only when `git log HEAD..origin/main` is empty. Another session shares this working tree, so never stash.

## Review Focus

1. **A probe with errored runs,** for example base 3/3 against head 0/2 valid. The test uses valid runs only: p = 0.10, so the label is `uncertain` and the probe does not gate. (Task 1)
2. **A probe the pull request adds** (`source: 'head'`) that regresses at p ≤ 0.05 never gates, as today. (Task 1)
3. **A base arm with 0 valid runs:** the status is `inconclusive`, the difference is `null`, and nothing crashes. (Task 2)
4. **`--extend` no larger than `--runs`** is exit 2, with a message naming both. (Task 4)
5. **An extended probe partly cached** counts its cached runs once, in both rounds. (Task 4)

---

### Task 1: An exact test behind every verdict

**Files:**
- Modify: `src/eval/eval.ts`: `ProbeStatus` gains `'uncertain'`, and `status()` and `gated()` change.
- Test: `tests/eval/eval.test.ts`, the `describe('status')` block and the gate tests.

**Interfaces:**
- Produces:
  - `export function fisherOneSided(base: { passed: number; valid: number }, head: { passed: number; valid: number }, direction: 'down' | 'up'): number`. This is the hypergeometric probability of a head pass count at least as extreme as the one seen, with margins fixed. `'down'` sums P(X ≤ head.passed), `'up'` sums P(X ≥ head.passed).
  - `status(base, head)` returns `'improved' | 'regressed' | 'uncertain' | 'unchanged' | 'inconclusive'` (D118). Both arms still need at least 2 valid runs, or the result is `inconclusive`.
  - `ProbeStatus` adds `'uncertain'`.
  - `gated(o)` is `o.source === 'base' && o.status === 'regressed' && o.base!.valid >= 3 && o.head!.valid >= 3 && o.base!.passed / o.base!.valid >= 0.9` (D119).

- [ ] **Step 1: Write the failing tests.** Replace the `status` test with `it('improved and regressed need a one-sided Fisher p of at most 0.05; a gap of half the runs without it is uncertain')`, expecting:
  - `fisherOneSided(arm(3,3), arm(0,3), 'down')` is `0.05`, and `'up'` is `1`;
  - `fisherOneSided(arm(3,3), arm(1,3), 'down')` is `0.2`;
  - `fisherOneSided(arm(9,10), arm(3,10), 'down')` is `0.0099`, to 4 places;
  - `fisherOneSided(arm(10,10), arm(6,10), 'down')` is `0.0433`, to 4 places;
  - `fisherOneSided(arm(0,2), arm(2,2), 'up')` is `1/6`;
  - `status(arm(3,3), arm(0,3))` is `'regressed'`, and `status(arm(0,3), arm(3,3))` is `'improved'`;
  - `status(arm(3,3), arm(1,3))` is `'uncertain'`, as are `status(arm(0,2), arm(2,2))` and `status(arm(3,3), arm(0,2))` (Review Focus 1);
  - `status(arm(10,10), arm(6,10))` is `'regressed'`;
  - `status(arm(3,3), arm(2,3))` is `'unchanged'`;
  - `status(arm(0,1), arm(3,3))` is `'inconclusive'`.
  
  Add `it('only a probe that passes at least 0.9 of its base runs can gate, and never one the pull request adds')` through `runEval`, with the fake-claude scenario:
  - base 3/3 against head 0/3 gates, as today;
  - a probe whose base is 3/3 and head 0/3, but whose `source` is `'head'`, does not gate (Review Focus 2).
  
  Cover the 10-run base rule at unit level: export `gated` and test it on hand-built outcomes. Base 9/10 against head 3/10 gates; base 8/10 against head 1/10 does not, since 0.8 < 0.9.
- [ ] **Step 2:** `npx vitest run tests/eval/eval.test.ts`. Expected: FAIL, since there is no `fisherOneSided` and no `'uncertain'`.
- [ ] **Step 3: Implement.**
  - `fisherOneSided` sums binomial-coefficient ratios. Compute them in floating point, from a product of ratios, as the totals here never exceed a few hundred runs.
  - `status` tests in the direction of the observed difference.
  - Every `switch` or `Record` over `ProbeStatus` that fails to compile gets an `uncertain` entry in this task. Their wording is Task 2's and Task 3's; use the plain word `uncertain` for now.
- [ ] **Step 4:** `npx vitest run`. Expected: PASS, except the tests that pin today's `|Δ| ≥ 0.5` labels and `diagnose`'s 2-run replays. Update the label ones to the new verdicts here, and leave `diagnose`'s to Task 3; note them in the ledger.
- [ ] **Step 5:** commit `feat: improved and regressed need an exact test, and only a steady probe gates`, mutation-check, push.

### Task 2: Reports that say what a verdict means

**Files:**
- Modify:
  - `src/eval/eval.ts`: `ProbeOutcome` gains `difference`;
  - `src/report/eval.ts`.
- Test: `tests/eval/eval.test.ts`, `tests/report/eval.test.ts`.

**Interfaces:**
- Consumes: Task 1's `status`, `fisherOneSided` and `wilson`.
- Produces:
  - `export function difference(base: ArmResult | null, head: ArmResult | null): { value: number; interval: [number, number] } | null`. The value is head rate minus base rate, and the interval is Newcombe's hybrid score interval (method 10) built from the two Wilson intervals. It is `null` when either arm has no valid run.
  - `ProbeOutcome.difference` holds it for every outcome that ran.
  - `ProbeOutcome.baseNote?: 'flaky' | 'fails'` (D119): `'flaky'` for a base pass rate strictly between 0.2 and 0.8, `'fails'` for 0 passes in at least 2 valid base runs. It is set only for `source: 'base'`.

- [ ] **Step 1: Write the failing tests:**
  - **`it('the difference in pass rates has a Newcombe interval')`,** with values to 4 places:
    - 3/3 → 0/3 gives `-1` and `[-1, -0.2059]`;
    - 0/3 → 3/3 gives `1` and `[0.2059, 1]`;
    - 3/3 → 1/3 gives `-0.6667` and `[-0.9385, 0.0586]`;
    - 9/10 → 3/10 gives `-0.6` and `[-0.809, -0.1705]`;
    - a base with 0 valid runs gives `null` (Review Focus 3).
  - **`it('the report marks flaky and failing base probes, gives the difference with its interval, and says what uncertain means')`.** In `renderEval` text and markdown:
    - an outcome base 2/3, head 0/3, `uncertain`, `baseNote: 'flaky'` prints `uncertain`, and its notes include `flaky on the base (2/3): it never gates`;
    - an outcome base 0/3, head 0/3, `baseNote: 'fails'` notes `fails on the base: the probe or the base context is broken, so it can only improve`;
    - the markdown's interval line reads ``95% intervals: `deps` base 0.44–1.00, head 0.00–0.56, difference −1.00 (−1.00 to −0.21)``. This replaces today's "95% intervals (Wilson)" line, keeping each arm's Wilson interval;
    - the markdown footnote adds: `` `improved` and `regressed` need a one-sided Fisher p ≤ 0.05; `uncertain` means the pass rates differ by half or more without it. At 3 runs a side only a full flip, 3/3 against 0/3, can show. ``
    - `regressed` keeps its bold in markdown, and `uncertain` is plain.
- [ ] **Step 2:** `npx vitest run tests/eval/eval.test.ts tests/report/eval.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Set `difference` and `baseNote` where `runProbes` builds each outcome.
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: eval reports the difference with its interval, and marks flaky and failing base probes`, mutation-check, push.

### Task 3: Diagnose at 3 runs, and an uncertain miss

**Files:**
- Modify:
  - `src/cli.ts`: `diagnose --runs` defaults to 3 and must be at least 3;
  - `src/loop/propose.ts`: `judge`;
  - `src/report/diagnose.ts`: `ABLATION` and `PROBE_SAYS`.
- Test: `tests/loop/propose.test.ts`, `tests/report/diagnose.test.ts`, `tests/cli.test.ts`.

**Interfaces:**
- Consumes: Task 1's `'uncertain'`.
- Produces:
  - `judge` returns `'inconclusive'` when the miss's outcome is `uncertain`;
  - `diagnose --runs <n>` uses its own parser. `verify` and `outcomes --verify` keep `replayRuns`, with its minimum of 2, since they judge one arm against a pass rule, not two arms against each other.

- [ ] **Step 1: Write the failing tests:**
  - **`cli.test.ts`:** `diagnose --runs 2` is exit 2, with `expected at least 3: below 3 runs a side, no replay can show a difference at p ≤ 0.05`. With no `--runs`, the replay runs 3 a side, counted from the fake's argv log.
  - **`propose.test.ts`:** the existing validated replay passes at 3 runs a side: 0/3 → 3/3, `improved`, `validated`. A scenario where 1 of 3 base runs passes gives an `uncertain` miss and an `inconclusive` replay.
  - **`report/diagnose.test.ts`:**
    - an `uncertain` ablation reads `Not known: taking it out looks different, but not by enough runs to show it. Run again with more --runs.`;
    - an `uncertain` miss in the proposal reads `The replay looks better with the fix, but not by enough runs to show it, so whether the fix works is not known. Run again with more --runs or --extend.`
- [ ] **Step 2:** `npx vitest run tests/loop/propose.test.ts tests/report/diagnose.test.ts tests/cli.test.ts -t diagnose`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the run counts in the existing `propose` tests, for example "1 diagnosis, 8 replay runs" becomes the 3-a-side count. Say why in each test's comment.
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `fix: diagnose replays at 3 runs a side, the fewest that can show a fix works`, mutation-check, push.

### Task 4: A second round for a probe that looks different

**Files:**
- Modify:
  - `src/eval/eval.ts`: `RunOptions.extendTo`, the run loop and the cache read;
  - `src/cli.ts`: `--extend <n>` on `eval` and `diagnose`;
  - `src/loop/propose.ts`: passing it through.
- Test: `tests/eval/eval.test.ts`, `tests/cli.test.ts`.

**Interfaces:**
- Consumes: Task 1's `status`.
- Produces:
  - `RunOptions.extendTo?: number` (D121). Once a probe's first `runs` per arm are complete and `status` gives `uncertain`, its arms run on to `extendTo` valid runs each, if the extra runs fit in `--max-runs` with everything already planned. Then the probe's verdict is recomputed on every run.
  - A probe that could not extend, for lack of budget, keeps its first verdict and the reason `not extended: run budget (<n> runs)`.
  - The cache read keeps up to `Math.max(runs, extendTo ?? runs)` records, so cached runs count once, in either round.

- [ ] **Step 1: Write the failing tests:**
  - **`it('--extend runs an uncertain probe on to n a side and tests again on every run')`:**
    - the fake-claude scenario passes the base on odd runs only, through `when.oddRun`;
    - with `runs: 3, extendTo: 10`, the uncertain probe ends at 10 valid runs a side;
    - a probe that was `unchanged` at 3 stays at 3;
    - `totals.runs` counts both.
  - **`it('an extension that does not fit the run budget keeps the first verdict, and says so')`:** with `maxRuns: 8` and an uncertain probe at 3 a side, the outcome is `uncertain` with reason `not extended: run budget (8 runs)`.
  - **`it('cached runs count once in an extended probe')`** (Review Focus 5): a cache holding 10 base runs for the probe gives 10 base runs and 0 new base runs.
  - **`cli.test.ts`:** `eval --runs 3 --extend 3` is exit 2, with `--extend (3) must be more than --runs (3)` (Review Focus 4).
- [ ] **Step 2:** `npx vitest run tests/eval/eval.test.ts tests/cli.test.ts -t extend`. Expected: FAIL.
- [ ] **Step 3: Implement.** The run loop's inner `for (let i = 0; i < opts.runs; i++)` gains a second pass, from `runs` to `extendTo`, for a plan whose stage-1 status is `uncertain`. The budget check is the same `planned + cost <= opts.maxRuns` the first pass uses.
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: eval and diagnose --extend give a close result a second round of runs`, mutation-check, push.

### Task 5: The guide, the decisions, and an A/A run

**Files:**
- Create:
  - `journey/20-honest-verdicts.md`;
  - `docs/dogfood/2026-11-24-honest-verdicts.md`.
- Modify:
  - `the-guide/evals.md`: the verdict table, the gate paragraph, and a new "What each run count can show" table;
  - `the-guide/misses.md`: diagnose's 3-run minimum and `--extend`;
  - `the-guide/commands.md`;
  - `journey/decisions.md`: D118 to D121;
  - `README.md`: tick the "Honest verdicts" roadmap item;
  - this plan's progress table.

- [ ] **Step 1: An A/A run,** live, on Claude Code with sonnet:
  - on one of Plan 2's public repositories in `F:/ctxlock-live/repos`, run `eval --base HEAD --all --runs 3` with the head the same as the base, cache off;
  - count how many probes the old `|Δ| ≥ 0.5` rule would have labelled, from each outcome's ratios, against how many the new verdicts label;
  - then run one probe with `--extend 10`, and record the extra runs;
  - record the cost of each run, and the 7-day usage-window change the report prints.
- [ ] **Step 2: Write the docs** from what the run showed. The table "What each run count can show" gives the smallest drop each n can show at a one-sided p of 0.05 with 80% power, from a base of 0.9–1.0:

  | Runs a side | Smallest drop it can show |
  |---|---|
  | 3 | 93 points, from a perfect base only |
  | 5 | 84 points |
  | 10 | 49–59 points |
  | 20 | 32–38 points |

  The figures are the review's own calculation, and the table says so.
- [ ] **Step 3:** `npm run ci`. Expected: exit 0.
- [ ] **Step 4:** commit `docs: honest verdicts in the guide, D118-D121, and an A/A run`, push, and watch CI on both systems.
