# 11. The graph: what a change reaches, and who should look

[Plan 4](../docs/superpowers/plans/2026-11-08-ctxlock-graph.md) is the first plan of Phase 2. It covers the dependency graph within one repository. Before it, this stretch closed out Phase 1:
- Plan 3's ten deferred minors, one commit each;
- a CI failure on Windows that three pushes had gone out on top of;
- the GitHub Action's first run on a live pull request.

## What exists now

- **`ctxlock.yaml` declares what relies on what.** `depends-on` takes a unit's path or ID, with an optional `@<tier>`, and `consumers:` names the agent configurations that use units (D58, D59).
- **`ctxlock who-uses <unit>`** lists:
  - the units that depend on it, directly or through others, with the chain;
  - the consumers that use it;
  - the agents predicted to load it (D61);
  - the files `build` generated from it.
- **`ctxlock impact --base <ref>`** lists what a change reaches and the owners to ask. The same section appears in the pull request comment, with every name as code so no one is notified. It never fails a check (D62).
- **`L15-graph`** reports three things:
  - a reference that names no unit, as a rename leaves behind;
  - a tier that is not met;
  - an `evals` path with no probe file.
- **`ctxlock eval`** runs the probes of everything a change reaches, not only of what it touched, and says why each ran.
- **The suite** has 486 tests.

## What worked

**The pieces were already there.** `ctxlock.yaml` had parsed `depends-on` since Plan 1, and nothing read it. `diff` already knew what changed, `unitOwners` already knew who owns a unit, and the resolvers already predicted loads. The graph is a few hundred lines that join them, built in memory from a scan (D60).

**The edges are already in the text.** In openai-agents-python, 11 of the 14 skills name another skill, such as `implementation-kickoff` sending the agent to `code-change-verification`. Declaring four of those references was enough for `impact` to name four dependent skills and a consumer on a one-line edit ([report](../docs/dogfood/2026-11-08-graph.md)).

**The Action, live.** On [a throwaway pull request](https://github.com/SatyamSingh-Git/ctxlock/pull/1):
- the check passed a harmless rule;
- the sticky comment appeared, with the behavioral section's skip note, and stayed one comment when updated;
- a zero-width space then failed the check with exit 1.

**Mutation checks kept finding real cases.** Each became a test:
- a top-level file whose name starts with `@`;
- a consumer that uses two units the change reaches, which must get the shorter chain;
- an `evals` path naming a file that is not a probe file, and a folder whose name is only a prefix of one;
- an empty Impact heading;
- a consumer the change does not reach, whose suite must not run.

One finding came from thinking past a test rather than from a mutation: `notes@v2.md` would have been read as the tier `v2.md`. Only a bare word after the last `@` is a tier now.

## What broke

- **CI on `main` was red for three pushes.** M5 compared paths with `path.relative`, and GitHub's Windows runner gives its temp folder by its 8.3 short name while git gives the long one. Local checks passed, on a machine whose temp path has no short name. The fix compares real paths, and each push is now watched to the end of its CI run ([mistakes](mistakes.md)).
- **The plan let a pull request hide its reach.** As written, `impact` walked the head's `depends-on`. A pull request could change a rule and delete the edge pointing at it in the same change, and the dependent's probes would not run. That breaks D30, under which a pull request cannot rewrite its judge. It was caught while wiring the probe selection in Task 6, before any of it shipped. Impact now walks both refs (D62).
- **A working-directory flip.** Twice, the session's directory switched to a lowercase drive (`f:\ContextFS`). Vitest then loaded itself twice and found no tests. Rerunning from `F:\ContextFS` fixed it; nothing was committed in between.

## What was learned

- **A graph earns its place in review before it earns it in automation.** The most useful output on a real repository was "Owners to ask". It is the line a reviewer needs, and nothing in the files said it.
- **What a pull request may change about its own check needs the same care everywhere.** D30 covered lint settings and probe definitions. The graph was a third place a pull request could weaken its own check.
- **Skills that name each other could suggest their own `depends-on`.** That is not built. The references in openai-agents-python show the information is there.
