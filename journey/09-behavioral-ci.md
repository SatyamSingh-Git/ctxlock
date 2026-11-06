# 9. Behavioral CI: the agent runs, nothing it tries does

[Plan 2](../docs/superpowers/plans/2026-11-06-ctxlock-behavioral-ci.md), written from the four spike memos and run straight after chapter 8 in the same session. It adds three things:
- `ctxlock eval`, which runs probes against Claude Code with a pull request's base context and its head context;
- `ctxlock probe draft`, which drafts those probes;
- a behavioral section in the GitHub Action.

The design's Phase 1 exit items (a) and (b) were then checked on three public repositories.

## What exists now

- **`ctxlock eval`.** For each probe whose unit the pull request changes, it copies each side out of git into a folder outside the repository, with execution config removed. It runs `claude -p` there 3 times per side, and reports how often the agent did what the probe expects, whether it loaded the changed unit, the tokens, and the cost. A hook written next to each run denies every command and edit, and every read outside the copy.
- **`ctxlock probe draft`.** Claude drafts candidates from a unit, with every tool off. ctxlock then runs each in a copy with the unit and one without, and writes only those that tell the two apart.
- **The Action.** With a Claude token or API key, it installs Claude Code and appends the behavioral section to the pull request comment. Without one it says why it skipped. It never fails the job unless asked to fail on a gated regression.
- **The suite** has 354 tests, all against a stand-in for Claude Code that runs ctxlock's real hooks. CI has no Claude credentials, so no test calls the real one.

## What worked

**The spikes had already done the hard part.** Every flag, the isolation, the AGENTS.md gap and the CI auth came from S1–S4, and the plan copied them. Most of the plan's work was the parts the spikes had not needed: the hostile pull request, the budget, the cache, the gate.

**Treating the pull request as hostile.** The spikes ran fixtures they controlled. A pull request can contain anything, so the plan asked what each file could make Claude Code do on the CI runner:
- **A project's hooks** run with `--setting-sources project`, and a skill's hooks run while it is active. They are removed from the copy (D38).
- **`Read` reaches any path,** including the process environment that holds the Claude credential. The hook confines it to the copy (D39).
- **Agent text in the comment** would carry out whatever the agent read. The comment holds counts only (D39).

The live checks then tried each of these, and each held.

**A control for each claim the live run could not prove on its own.** That an ancestor `CLAUDE.md` stayed out showed nothing until a run without `claudeMdExcludes` loaded it.

**Mutation checks found real gaps, again.** 83 mutations across Tasks 1–8, all killed in the end. The survivors before that were:
- a cache key that did not depend on the git tree, or on the probe;
- a status rule with untested thresholds;
- a head arm that could change its own settings;
- two skill-listing mistakes;
- a stream with no result counted as a valid run.

Each got a test.

## What broke

- **A command line has a length.** The first live draft failed with `ENAMETOOLONG` on a 38 KB `AGENTS.md`: the prompt was an argument, and Windows stops at 32,767 characters. No test could have shown it, since the tests' prompts were short and Linux allows more. Prompts now go on stdin (D45).
- **Tests run after the code, four times.** While a mutation run held the test files, code and tests were written together, and the tests were shown failing only afterwards ([mistakes](mistakes.md)).
- **Asking before pushing,** though Satyam had already said to push after each task. Sixteen commits waited; then Tasks 1–8 went up one by one.
- **Two statements about other tools from memory:** a `cli.js` that Claude Code's npm package does not have, and a cache GitHub does not share between pull requests. Both were checked and corrected before they were pushed.
- **The test harness for the live checks** had its own bugs: a `git revert -q` that does not exist, newlines that do not survive Git Bash, and a CRLF checkout. Each was caught by a guard that refused to edit text it could not find exactly once.

## What was learned

- **Real context files mostly repeat the repository.** `probe draft` kept 1 of 9 candidates. In `plano`, deleting `CLAUDE.md` changed nothing, because its skills say the same commands. This is the research's point about discoverable content (research/03), seen from inside a check.
- **A changed instruction still wins over the repository.** Each planted edit pointed the agent at a different tool than the repository's own lockfile, and the agent followed the instruction in 3 of 3 runs every time. A probe that cannot show a file helps can still catch an edit that changes what the file says. That is why D36 may be too strict for regression probes (D46).
- **The fallback prediction is needed in practice.** On `vercel-labs/skills`, Claude Code reported no load at all, yet the agent followed the edited `AGENTS.md` every time. Without D37, the report would say the agent never saw the change.
- **It is cheap.** A planted-edit check took 6 runs and about a minute, and cost about $0.10–0.21 as Claude Code reports it. The whole live pass moved the weekly usage window by one point.
