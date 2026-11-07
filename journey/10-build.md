# 10. Build: closing the gaps between agents, without touching what people wrote

[Plan 3](../docs/superpowers/plans/2026-11-07-ctxlock-build.md), written from the design's Phase 1 description of `ctxlock build` and spike S2, and run straight after the review fixes of chapter 9. It adds `ctxlock build`, a writer for the gaps between Claude Code and Codex, and a lint rule that catches drift in what it wrote.

## What exists now

- **`ctxlock build`** reports:
  - each agent's budget, before and after a fill;
  - each gap, with the file that would close it or the reason there is none;
  - drift between hand-written files that serve the same folder for different agents;
  - the state of each generated file.
- **`--fill-missing`** writes three kinds of file: a skill copied into the other agent's folder, a `CLAUDE.md` that imports an `AGENTS.md` Claude Code skips, and an `AGENTS.md` assembled from what Claude Code loads in a folder, including rules scoped to a folder. Nothing else.
- **`.ctxlock/generated.json`** records each generated file and what it came from. `L14-generated` reports a generated file that went stale or was edited, in `lint`, `diff` and the pull request check. `L11` and `L13` read a generated file as its source.
- **`--suggest-index <dir>`** prints the compressed docs index from Vercel's result, in the format of Next.js's own codemod, and writes nothing.
- **The suite** has 434 tests.

## What worked

**Building on what the static checks already knew.** `L13` already worked out the right fix for a shadowed `AGENTS.md`, `L11` already knew which units reach one agent, and the resolvers already knew what each agent loads. The planner turns those into files. The preview checks them by scanning the repository as it would be after the fill. No new model of either agent was needed.

**The spike paid off as a decision, not as code.** S2 showed what rulesync does to these two agents' files, so the plan could rule, with evidence, that ctxlock writes them itself (D49). rulesync stays the plan for the agents ctxlock cannot predict.

**Mutation checks kept finding real holes.** The mutation passes over Tasks 1–8 found these gaps in the tests, each now covered:
- an unsorted record;
- a generated file whose source is no unit;
- a symlink at a mirror that leaves the repository;
- the import hop limit;
- a file named `AGENTS.override.md`;
- a fill that refreshes a record without rewriting the file.

They also found code that tests could never tell apart from its absence, which went:
- a `chain-dropped` check covered by the byte comparison;
- a redundant sort;
- a kill that a closed pipe makes unneeded;
- a record comparison.

## What broke

- **A gitignored folder,** found live on plano. The first fill wrote five skill copies into `.agents`, which plano ignores, so they could never be committed, and ctxlock's own reader reported them missing. A gitignored target is now a gap (D55), using the check `L9` had, now shared.
- **Two digests for one file.** Discovery hashes files with CRLF read as LF; the first version of the record used raw bytes. A CRLF test fixture showed the mismatch. On a real team, a record written on Windows would have read as edited on Linux CI (D54).
- **An "up to date" that never was.** A source change that left the output the same, such as trailing whitespace, would have kept `L14` saying "stale" forever, because the planner saw nothing to write. The record is now refreshed in that case.
- **The final review: one critical finding, six important ones.** A fresh reviewer, on the strongest model, reproduced each on a throwaway repository:
  - writes through a link git does not list (see [mistakes](mistakes.md));
  - ignore rules only git knows;
  - a rule glob such as `/src/**` that hung the planner;
  - a report that showed what was generated as it stood before the fill;
  - a fill that could make Codex cut a person's `AGENTS.md` (D57);
  - a skill with linked files copied to the wrong paths;
  - a copy that kept files its skill had dropped (D56).

  A seventh was re-graded up from minor: on a checkout with `core.autocrlf`, the first fill wrote mixed line endings and later fills rewrote files that had not changed. Each fix began with a test that failed.
- **Backslashes through a heredoc, twice more.** The guard that refuses an edit it cannot place exactly once caught both, and the Edit tool did them instead.

## What was learned

- **A writer has to know what git will keep.** Everything `build` writes is meant to be committed, and nothing in the agents' own rules says a folder is ignored. Only a real repository showed it.
- **The cost of a fill belongs in front of the person before it is made.** On plano, one generated one-line `CLAUDE.md` imports an `AGENTS.md` that adds 72 KB to Claude Code's always-on context in that folder. ctxlock writes it, because nothing is cut, and the budget table shows the cost before anyone commits it.
- **Skills were the most common gap.** In two of the three public repositories, most of what one agent missed was skills the other could not see.
