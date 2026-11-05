# 5. The first batch: reading repos and predicting what agents load

Tasks 1–5 of [the plan](../docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md), built test-first in one session on `main`, one commit per task, each pushed once `npm run ci` was green locally. GitHub runs it again on Ubuntu and Windows.

## What exists now

| Task | What it does | Where |
|---|---|---|
| 1 | Reads a repository two ways, as the working tree and as any git ref, with symlinks resolved inside the repo and refused outside it | `src/repo/reader.ts` |
| 2 | Finds every context unit (instructions, rules, skills, agent config), parses frontmatter, and gives each a content digest | `src/units/` |
| 3 | Loads `ctxlock.yaml` and CODEOWNERS, so every unit has an owner | `src/registry/` |
| 4 | Predicts what Claude Code loads at each directory: the `CLAUDE.md` chain, `@imports`, rules, nested files, the skill listing | `src/harness/claude-code.ts` |
| 5 | Predicts the same for Codex, and turns both into a per-site budget report | `src/harness/codex.ts`, `src/report/budget.ts` |

71 tests. Almost all were watched failing before the code existed. Every one was **mutation-checked**: the code was deliberately broken in the way the test claims to catch, and the test had to go red. That second check is the only proof for the few tests added after the code.

There is no command to run yet. That is Task 11.

## What worked

**Reusing instead of inventing paid off immediately.** Codex can't be run here, so its prediction is checked against Codex's own tests: seven cases from `codex-rs/core/src/agents_md_tests.rs`, ported with the upstream commit recorded. The budget arithmetic came straight from reading `agents_md.rs`: the file that crosses 32 KiB is cut to the bytes left, and everything after it is dropped. That is more precise than any documentation.

**A worked example found the most useful thing ctxlock says so far.** Writing [the guide's agents page](../the-guide/agents.md), the example was run through the real resolvers rather than written by hand. With `CLAUDE.md` symlinked to `AGENTS.md` at the root (the setup the AGENTS.md FAQ recommends) and a second `AGENTS.md` in `services/api/`:
- Claude Code never loads `services/api/AGENTS.md`, because a `CLAUDE.md` exists further up.
- Codex loads only 12,768 of its 15,000 bytes, because the root file used most of the budget.

Nobody sees an error in either agent.

**Mutation checks kept finding weak tests.** In Task 4, a test for "`@` inside inline code is not an import" passed even with the inline-code handling deleted. Its fixture put the `@` right after a backtick, where the import pattern never matches anyway. In Task 5, adding one more fixture (a nested Claude skill) exposed a real bug: the budget report listed lazily loaded skills as "truncated", because a skill's body is never in context until it is invoked.

## What broke

See [mistakes.md](mistakes.md) for each in full.
- **The file-writing tool put invisible characters into our own source.** It turns `\uXXXX` escapes for invisible characters into the raw characters. A raw BOM sat in `src/units/frontmatter.ts` until a mutation refused to apply. `tests/hygiene.test.ts` now fails the build if it happens again.
- **A mutation run reported 19 of 19 mutations killed against a red baseline.** One new test was already failing on the unmutated code, so every mutation looked killed. The script now refuses to run unless the baseline is green, the same lesson as the hidden-character scan that never ran.

## The review

A fresh reviewer read all five tasks with no knowledge of how they were built. It ran the suite, compiled the code into a scratch folder, and reproduced every finding against real git repositories. Verdict: **ready with fixes**. It found one critical issue, five important ones, and fourteen minor ones.

**Critical: the reader followed symlinks out of the repository.** The rule "a symlink that leaves the repo is never followed" was enforced when *listing* files, but `readFile` and `exists` read any path they were asked for. A pull request that adds `ctxlock.yaml -> /some/secret` would get the secret parsed, and a YAML error quotes the offending line into a public CI log. The reader now serves only files in its own listing, exactly as the git-ref reader already did.

**Important:**
- **CRLF.** A Windows checkout with `core.autocrlf` and the same file in git got different digests, so a future `ctxlock diff` would report every unit as changed. The design said "normalized bytes"; the code hashed raw ones.
- **Subdirectories.** The two readers listed different paths when opened on a subdirectory.
- **Symlinks.** They worked only when the link pointed straight at a unit. A `.claude/skills -> ../.agents/skills` directory link, a common workaround, produced a false "not visible" note. The guide had already claimed "ctxlock follows symlinks inside the repository".
- **Sparse checkouts and nested repositories** crashed discovery with a stack trace.
- **The Claude Code prediction had drifted from the current docs.** Skills and rules load from every parent of the start directory, not just the root. The 40,000-character cap covers more file kinds. `.claude/AGENTS.md` and nested `AGENTS.md` are read in fallback mode. Before fixing this, a separate agent fetched Claude Code's docs and quoted each rule, so the fix follows the docs, not the reviewer's summary of them.

One minor finding was promoted: CODEOWNERS matching differed from GitHub's, while the guide promised GitHub's. All of these were fixed in one pass. Each fix was proven by a test that failed first, and the fix pass was mutation-checked (25 of 25 caught). The suite went from 71 to 89 tests, green on Ubuntu and Windows. The other minors and every judgement call are recorded with their cost if wrong.

## What was learned

- **A check whose failure looks like success is worse than no check.** This happened three times in one batch: the scan that printed "none" on error, the mutation run on a red baseline, and the test that couldn't fail. Each fix had the same shape: make the failure path say something different, and prove it with a positive control.
- **Run the example, don't write it.** The guide's example output is real output. Writing it by hand would have missed the `services/api` case entirely.
- **A safety rule has to hold at every entry point, not the obvious one.** "Never follow a symlink out of the repo" was true of the listing and false of the reads, and only an outside reader looked at both.
- **Vendor behaviour has to be re-read at build time, as the plan said.** Task 4 was built from the research notes instead of the docs. The notes were incomplete, and the docs already describe a newer Claude Code than the one installed here: the on-demand cap arrived in 2.1.309, against 2.1.292 installed.
