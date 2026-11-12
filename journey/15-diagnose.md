# 15. Diagnose: from a miss to a fix someone can check

[Plan 8](../docs/superpowers/plans/2026-11-12-ctxlock-diagnose.md) is Phase 3's second plan. Plan 7 found the moments a unit was in context when the person stopped or corrected the agent. This plan takes one unit from there to a verdict, a fix and a check that the fix works. Satyam's instruction, on 2026-11-12, was "continue the work", so the open calls, D83 to D88, are mine, and are marked so.

## What exists now

- **`ctxlock diagnose <unit>`** sends Claude the unit's text and the redacted moments it was in context for: the task, what the agent did, and the correction (D83). The run has no tools.
- **A verdict:** `defect`, `gap`, `preference`, `agent-error` or `unclear` (D84). The reply is checked against the unit: a quote that isn't in the file refuses the diagnosis.
- **For a defect or a gap with a correction:**
  - **The fix:** one exact replacement in the unit's text (D85).
  - **The probe:** one, made from the correction.
  - **The replay:** both run through `eval`'s runner, on a copy with the fix and a copy without (D86).
- **`--drafts`** writes the proposal for the owner. **`--open`** files it, or updates it, as one GitHub issue in the repository that owns the unit, with nothing from the session in it (D87).
- **Nothing is written to the repository.**
- **`eval`'s paired runner is now `runProbes`,** which takes two readers. `eval` and the replay share it.
- **Each signal from `misses` now carries its turn's task and the agent's actions.** Before, it had only the person's words.
- **The suite** has 661 tests.

## What worked

**The planted miss, live.** A fixture whose rule says npm while its `package.json` names pnpm, and a session where the person writes "no, we use pnpm here". On real Claude Code, both runs:
- gave a `defect` verdict, resting on the rule's one wrong line;
- proposed a fix that replaced it;
- went from 0 of 2 to 2 of 2 on the replay.

Each took under 40 seconds and 5 runs, and the repository was clean afterwards ([report](../docs/dogfood/2026-11-12-diagnose.md)).

**Reusing what was there.**
- **The replay** is `eval`'s runner, with an overlay reader as head. It isolates runs as `eval` does, with no new code for that.
- **The proposal** uses the drafts folder's rules from Plan 7, the edited-file guard included.
- **The issue's body** is the proposal file, so what goes on an owner's tracker is what a person can read first in the drafts folder.

**Mutation checks, task by task:**

| Task | Killed |
|---|---|
| Each signal's task and actions | 8 of 8 |
| The diagnosis and the fix | 14 of 14 |
| `eval`'s runner taking two readers | 3 of 3 |
| The command, the replay and the proposal | 14 of 14 |
| Filing the issue | 18 of 18, after 2 survivors |

The two survivors in the last task were real gaps:
- **An unanchored match.** A URL that only contained a GitHub URL, such as a mirror's path, would have been read as that GitHub repository, so an issue could go to the wrong tracker.
- **`--state all`.** Nothing checked that a closed issue is found again, so a unit missed again after its issue was closed would get a second one.

Both got a test, and the mutants were run again.

## What broke

- **The live setup, before it ran.** A scratch `CLAUDE_CONFIG_DIR` holds the planted transcript. But the replay's Claude Code runs inherit the environment, and with that variable set they would find no login. A wrapper that drops the variable fixed the run. For a person, the folder Claude Code uses and the one ctxlock reads are the same, so this is the fixture's problem, not theirs.
- **The final review found four things an owner would have got wrong.** A fresh Opus reviewer read the whole branch:
  - **A wrong promise:** a proposal whose replay failed still said the probe "fails without the fix and passes with it", and `--open` would have put that on the owner's tracker.
  - **Unusable fixes:** a fix that adds lines was printed with its newlines as `?`.
  - **Duplicate issues:** one issue per unit rested on GitHub's search index, which lags behind new issues.
  - **Refused replies:** a reply whose fix held a code fence was refused, since the block ended at the first fence.

  All four were fixed test-first. The six minors were fixed too, at Satyam's request, one commit each. Two changed what the tool concludes: a linked unit's fix used to replay as not validated, and a moment after web or MCP content now counts for less. `--open` has still not run against real GitHub.
- **Tests written wrong, three times:** an `await` inside an arrow that wasn't `async`, a fixture whose text occurred twice when the test meant once, and a sort order expected backwards. Each failed for the wrong reason first, and was fixed in the test.

## What was learned

- **The rule beat the repository.** In every base run, the agent ran no command the probe accepts, though `package.json` names pnpm. A wrong rule outweighs the evidence in the files, which is why finding one matters.
- **The probe is the part to keep.** The two runs worded the fix differently and wrote the same probe. The probe is what checks the next edit to the rule.
- **2 runs a side gives a direction, not proof.** 0 of 2 to 2 of 2 is a one-sided p of about 0.17. The guide says so, and that `--runs 3` reaches the 0.05 that `eval` gates on.
- **One planted miss proves the parts, not the diagnosis.** How often a real miss gets the right verdict will take real misses joined to real units. The author's own repositories have none yet.
