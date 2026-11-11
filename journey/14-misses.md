# 14. Misses: when the agent was stopped or corrected, what was in its context

[Plan 7](../docs/superpowers/plans/2026-11-11-ctxlock-misses.md) is Phase 3's first plan, the start of the feedback loop. Satyam's instruction, on 2026-11-11, was "start the work, move to next part". So the open calls, D77 to D82, are mine, and are marked so.

## What exists now

- **`ctxlock misses`** reads Claude Code's own transcripts for the sessions the collector recorded in a repository. It finds two kinds of moment:
  - the person interrupting the agent;
  - the person correcting it ("no, …", "I meant …").

  It joins each moment to the units in context, from the collector's loads, and counts, per unit, the distinct sessions it turned up in (D78–D81).
- **A unit reached in 3 sessions is routed.** A session counts once per unit, and half when the agent had read a web page or an MCP tool's output first.
- **`--drafts`** writes a note for each routed unit's owner, in the repository that owns it: for a synced unit, its upstream (D82). With `--excerpts`, the note holds the person's corrections, redacted and fenced.
- **Nothing is stored and nothing is sent.** Transcripts are read where Claude Code keeps them.
- **`sessionTimelines`** is the per-session part of `joinSessions`, now shared by `loads` and `misses`.
- **The suite** has 615 tests.

## What worked

**Checking the data before writing the plan.** Before a line of the plan, a few scripts read the author's 1,038 transcripts:
- **How a typed prompt is marked:** `origin.kind: "human"`, or `turnOrigin` in older versions.
- **What isn't typed but carries the mark:** compaction summaries, which also quote earlier prompts.
- **What an interrupt looks like.**
- **How often the phrase list matched:** 5 of 676 prompts after the first exclusions, all genuine.
- **That no real rejection exists to check against:** the one hit was this session's own search, quoted in a tool result. That is why a signal matches a line's structure, never a substring.

**Mutation checks, task by task:**

| Task | Killed | Survivors first |
|---|---|---|
| Signals from a transcript | 19 of 19 | 1: a correction's words held the whole prompt |
| Per-session timelines | 8 of 8 | 1: a gap in the existing tests, a session's last event |
| Joining signals to units | 18 of 18 | 4: loads after the signal, sessions without a signal, the order of trust within a session, other bytes in a session without one |
| The command | 16 of 16 | 1: a bad date failed for the wrong reason |
| Drafts and redaction | 27 of 27 | 3: a long word with no digit, a correction's words unredacted, a unit ID with a space |
| The live run's two fixes | 11 of 11 | none |

Each survivor got a test, and the mutant was run again.

**The live run, against an independent scan.** A separate script, written without ctxlock's code, found the same signals at the same times in all three repositories ([report](../docs/dogfood/2026-11-11-misses.md)).

## What broke

- **The plan's rule for "in play" joined nothing.**
  - **The rule:** a signal's units were those loaded in its turn (D80).
  - **What happened:** the first live run joined none of 6 real signals to a unit. Files load when a session starts, and people stop the agent many turns later, while the file is still in context.
  - **The fix:** every unit loaded before the signal is in play. "In its turn" is kept as the closer link (D80a).
  - **Why it hurts:** the transcripts were checked closely before the plan, and the collector's timing was not ([mistakes](mistakes.md)).
- **One name for two situations.** Signals that joined nothing were all "before any unit loaded". In ctxlock's own repository, which has no `CLAUDE.md` of its own, no unit is ever in context. In the other two, the signals came before the collector was recording at all. Now each is counted under its own name, and a signal from before recording is joined to nothing.
- **Shell strings, twice more.** A test with backticks went through `bash`, which ran them as commands, and a `\n` in a `node -e` edit arrived as a real newline. Both were redone with the Edit tool, as the rule from Plan 6 says. They happened anyway.

## What was learned

- **A rule that joins two sources needs both sources' data in front of it.** The plan's reasoning about turns was sound for the transcript alone. The join failed on the other side, when loads happen.
- **"Nothing in context" and "unknown" are different answers.** A tool that collects from the moment it was installed has to say which of its history it saw.
- **Exposure is honest but blunt.** In the one repository where a unit was joined, it was the `CLAUDE.md` that every session loads. That is why the drafts say "signals, not a diagnosis", and why Plan 8's diagnosis and replay matter.
- **Scanning a large repository costs more than reading its transcripts.** On the private project, `misses` spent 100 of its 101 seconds in the scan that `scan` and `loads` share.
