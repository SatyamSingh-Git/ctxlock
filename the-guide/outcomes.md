# Outcomes: whether a fix held, and the numbers that compound

[`misses`](misses.md) finds the moments a unit was in context when you stopped or corrected the agent. [`diagnose`](misses.md#diagnosing-a-unit) turns one into a proposed fix with a probe. `ctxlock outcomes` closes the loop:
- it finds the fixes that shipped;
- it says whether each one held at 7 and 30 days;
- it counts helpful and harmful sessions per version of each unit;
- it gives the compounding numbers: time to fix, regression rate, durability, reach, and units never loaded.

`ctxlock verify` re-checks a unit by its probes when its `stale-after` date has passed.

```
ctxlock outcomes [dir] [--format text|json] [--locks <folders...>] [--verify] [--runs <n>] [--max-runs <n>] [--max-minutes <n>] [--model <model>] [--claude <path>] [--workdir <dir>]
ctxlock verify [dir] [--unit <ref>] [--format text|json] [--runs <n>] [--max-runs <n>] [--max-minutes <n>] [--model <model>] [--claude <path>] [--workdir <dir>]
```

This is real output, from the exit demo: an org repository's rule said `npm install` while its `package.json` named pnpm, a session there ended with "no, we use pnpm here", and two consumers took the fixed rule with `sync` ([report](../docs/dogfood/2026-11-13-outcomes.md)):

```
ctxlock outcomes · 1 session recorded

Shipped fixes:
  rule/.claude/rules/deps.md  shipped 2026-11-13 in 66cf596, 2 minutes after its first signal
    7 days   pending: so far 0 sessions
    30 days  pending: so far 0 sessions
    Reached: pinned by docs, web

Helpful and harmful, by the version loaded:
  instructions/CLAUDE.md      unknown bytes  helpful 0  harmful 1
  rule/.claude/rules/deps.md  unknown bytes  helpful 0  harmful 1
  Harmful counts sessions with a signal while the unit was in context, not proven harm; a session whose signals all followed web or MCP content counts half.

The numbers:
  Median time to fix     2 minutes, over 1 fix
  Regression rate        - (no fix's window has closed with sessions in it)
  Durability at 30 days  - (no 30-day window has closed and been judged)
  Fixes × consumers      2, over 1 fix
  Never loaded           0 of 2 units, in 1 session; ctxlock loads lists them
```

## What ships a fix

A fix ships when a commit adds the probe `diagnose` wrote for it, which is the one whose id starts with `miss-`. The proposal says to commit the probe with the fix, so that commit is the fix shipping. ctxlock reads this from git history. It keeps no record of its own.
- **When:** the committer date of the first commit that added the probe's id under `evals/probes/`. A probe edited later, or removed and added back, keeps its first date.
- **One probe per fix:** the id `diagnose` writes names the unit and the bytes it had, so after a fix that missed again, the next fix's probe has an id of its own, and its own ship date.
- **The fix's versions:** the unit as it was at that commit, at every later commit that descends from it and changed it, and in your working tree. A later edit to the unit still carries the fix. A branch that forked before the fix and merged after it brings no version, since its commits never had the fix.
- **Listed apart:**
  - a probe whose unit is gone;
  - a commit that added the probe but left the unit as it was.
- **A shallow clone** can't say when a probe arrived, so `outcomes` stops with exit 2: run `git fetch --unshallow`.
- **Outside git,** there are no shipped fixes, and the counters still show.

## Did it hold

A fix held when the sessions that saw it were not stopped or corrected over it.
- **Seeing it:** a session saw the fix when the [collector](collector.md) recorded it loading the unit with the bytes of one of the fix's versions.
- **Not judged:**
  - a session on older bytes, such as an old branch;
  - a session with unknown bytes: a skill call, a predicted load, or a file the collector couldn't hash;
  - a session whose transcript is gone, since its signals are in it. Claude Code removes transcripts after 30 days by default, so `outcomes` says how many it left out, and they count for no window and in neither counter.

Each window runs from the ship time to 7, or 30, days after it, to the minute, whatever time zone the commit was made in. A window is one of:
- **`held`:** sessions saw the fix, and none had a signal with the unit in context.
- **`missed again`:** some did. A signal counts only after the session loaded the fix, inside the window, and never one from before the collector recorded the session.
- **`no session loaded the fix`:** the window closed without one.
- **`pending`:** it hasn't closed yet. It also says how it stands so far.

## Helpful and harmful

For each unit, and each version of it a session loaded, `outcomes` counts sessions in two kinds, after ACE's counters:
- **Harmful:** the session had a signal while the unit was in context. That means the unit was there when something went wrong, not that it caused it. A session whose signals all came after the agent read a web page or an MCP tool's output counts half, as `misses` counts it.
- **Helpful:** the session loaded the unit and had no such signal.

A session's version is the digest of its first load of the unit that has one. **Today** marks the bytes the unit has now, and **a fix** marks one of a shipped fix's versions. A session whose only signals came before the collector recorded it counts as neither.

## The numbers

Each number says what it was counted over, and none is guessed:
- **Median time to fix:** from the first recorded signal with the unit in context, before the fix shipped, to the ship time. A fix with no such signal has no time. Under a day it reads in hours or minutes.
- **Regression rate:** of the fixes with a window that has closed with sessions in it, how many were missed again in a closed window. A fix whose 7-day window had no sessions and whose 30-day window missed again is a regression. With `--verify`, a fix whose probe was run again counts as judged too, and one whose probe fails today counts as regressed.
- **Durability at 30 days:** of the fixes whose 30-day window has closed with sessions in it, how many held.
- **Fixes × consumers:** for each fix, the consumers in `ctxlock.yaml` its unit reaches, as [`who-uses`](graph.md) finds them, plus, with `--locks <folders...>`, each repository whose `ctxlock.lock` pins the unit at one of the fix's versions. A repository still on the older version doesn't count.
- **Never loaded:** units that no recorded session loaded, out of those the sessions could have loaded. They are candidates for deletion. [`loads`](commands.md#ctxlock-loads) lists them.

## Re-checking a unit: `ctxlock verify`

When a unit's `stale-after` in `ctxlock.yaml` has passed (today, in local time, as [`L9`](rules.md) reads it), `verify` runs that unit's own probes on the repository as it is, with your own `claude`, as `eval` does. `--unit` names one unit instead, due or not.

```
ctxlock verify · 1 unit, 3 runs

  rule/.claude/rules/deps.md  holds
    miss-rule-.claude-rules-deps.md-4d49356f  3 of 3 passed

In ctxlock.yaml, for the units that hold:
  units:
    .claude/rules/deps.md:
      verified-at: 2026-11-13
      stale-after: 2027-02-11
```

- **The runs:** one side only, every action the agent tries denied, as in `eval`. `--runs` defaults to 3 and must be at least 2; `--max-runs` is 16 and `--max-minutes` 15.
- **Each unit is one of:**
  - `holds`: every probe passed in each of at least 2 runs that finished without an error;
  - `fails`: a run that finished failed. `verify` then exits 1;
  - `inconclusive`: a budget cut it short, or a probe had fewer than 2 such runs;
  - `no probes`: [`probe draft`](evals.md) can draft some.
- **For a unit that holds,** it prints the lines to set: `verified-at` today, and `stale-after` today plus the unit's own interval, or 90 days when it has none. It never writes `ctxlock.yaml`: those dates are the owner's record.

`outcomes --verify` runs each shipped fix's probe the same way, and reports it on the fix as `Its probe today:`.

## What it reads and sends

- **`outcomes` reads:**
  - git history;
  - the collector's events;
  - the transcripts `misses` reads.

  It writes nothing, makes no network call, and runs no agent unless you pass `--verify`.
- **`verify` and `outcomes --verify`** run Claude Code in throwaway copies of the repository, as `eval` does. They write nothing to it.

## What it doesn't do yet

- **A miss recorded in a consumer and fixed in its upstream:** it joins two repositories' records, and waits for the org tier.
- **Clustering signals across people,** and the other signals the design names: rejected tool uses, abandoned sessions, a skill that should have loaded.
- **Replay with a unit taken out.**
