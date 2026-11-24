# Dogfood: honest verdicts, an A/A run

**Date:** 2026-11-24. **Build:** ctxlock at 220c722 (Plan 14, Tasks 1–4). **Agent:** Claude Code 2.1.319 on claude-sonnet-5-5.

**Question:** with the head the same as the base, so nothing can truly change, how many probes do the old rule and the new verdicts label `improved` or `regressed`? The old rule was a gap of half the runs; the new verdicts need a one-sided Fisher p ≤ 0.05 (D118).

## Results

- **11 probe outcomes, with no change behind any of them.** plano's own two probes ran twice.
  - **The old rule** would have labelled 1 of them, `coin-2`, `regressed`.
  - **The new verdicts** labelled none. `coin-2` came out `uncertain`, ran on to 10 a side with `--extend 10`, and ended `unchanged`.
- **Every real probe was steady:** 3/3 against 3/3, except one that failed every run on both sides. That one is marked `fails on the base`, and it turned out to be the probe's fault (below).
- **Cost:** 94 runs in all, $1.53 notional on a subscription, about 10 minutes, the 2 kept to see one probe's commands included. The 7-day usage window the reports print stayed at 34–35%.

## The runs

Each was `ctxlock eval --base HEAD --all --runs 3 --cache <a new empty folder>` on a clean working tree, so the head was the base.

| Repository | Probe | Base | Head | Verdict | Old rule | Note |
|---|---|---|---|---|---|---|
| [katanemo/plano](https://github.com/katanemo/plano) at 3a227a1 | `typecheck-with-npm` | 3/3 | 3/3 | unchanged | unchanged | |
| | `python-tests-skill` | 3/3 | 3/3 | unchanged | unchanged | |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) at d902141 | `tests-use-pnpm` | 3/3 | 3/3 | unchanged | unchanged | |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) at be40765 | `uv-run-python-script` | 0/3 | 0/3 | unchanged | unchanged | fails on the base |

Costs: 12 runs in 98 s ($0.20); 6 in 32 s ($0.11); 6 in 61 s ($0.19).

**Close calls, in a local clone of plano.** Real probes were all steady, so `--extend` had nothing to extend. To see `uncertain` live, a clone that is never pushed got probes the agent has room to vary on, run with `--runs 3 --extend 10 --max-runs 60`:

| Probe | Prompt | Base | Head | Verdict | Note |
|---|---|---|---|---|---|
| `install-js-with-npm` | Install the JavaScript dependencies. The repository has both `package-lock.json` and `bun.lock` | 3/3 | 3/3 | unchanged | |
| `tests-with-cargo` | Run the tests. It has Rust, Python and JS tests | 3/3 | 3/3 | unchanged | |
| `coin-1` | Pick `npm test` or `pnpm test` at random and run it | 2/3 | 2/3 | unchanged | flaky on the base |
| `coin-2` | The same | 4/10 | 5/10 | unchanged, after `--extend` | flaky on the base |
| `coin-3` | The same | 2/3 | 3/3 | unchanged | flaky on the base |

The first two, with plano's own two probes, were 24 runs in 137 s ($0.34). The same check again, as markdown, ran 12 head runs and took the 12 base runs from the cache ($0.18). The coin probes were 32 runs in 185 s ($0.36): 18 in the first round, and 14 more for `coin-2`.

**`coin-2`.** Its first three base runs went pass, fail, pass (from the cache file), and since it was extended, its first three head runs all failed. 2/3 against 0/3 is a one-sided p of 0.2: `uncertain` under D118, `regressed` under the old rule. At 10 a side it was 4/10 against 5/10. Nothing had changed: the old rule would have reported a regression that was noise.

## What the run found

- **A probe broken by the agent, not the context.** `uv-run-python-script` passed 3/3 on its base in the 2026-11-06 run, on Claude Code 2.1.292. Today it fails every run on both sides. One run kept with `--keep-runs` shows why: the agent still follows `AGENTS.md`'s "use `uv run python ...`", but now types `cd examples/basic && uv run python hello_world.py`. The probe's pattern wants the path after `python`, so it fails. The new note says what to do: "fails on the base: the probe or the base context is broken, so it can only improve". This is the agent drift Now 2 of [D117](../../journey/decisions.md) is about, caught by the probe turning red on both sides. The probe lives in the test repository, outside ctxlock, and is left as it is.
- **The coins were near enough fair.** 18 of the 32 draws picked npm.
- **The flaky note fired where it should:** on all three coins, and on none of the steady probes.

## Not shown

- **Too few probes to measure a rate.** 11 outcomes, 1 of them mislabelled by the old rule, is an example, not the 4–22% the review estimated. Real probes on these repositories are steady, so on them both rules agree.
- **No live `improved` or `regressed`** came from this run, as none should: the head was the base. The 2026-11-06 report has live flips.
