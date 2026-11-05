# Mistakes

Kept in full, because the corrections are the most transferable part of the record. Each entry gives what happened, what caused it, what it cost, and what changed.

## Research

### Eight research agents sharing one search budget

All eight research tracks ran out of web-search budget partway through, and fell back to fetching known URLs and reading GitHub's API.

*Cause:* the tracks ran in parallel against one shared per-turn budget, and nobody planned for it.

*Cost:* each report has claims marked unverified, such as some vendor funding figures, a Glean MCP detail, and Collibra's 2026 announcements.

*Changed:* nothing load-bearing is built on an unverified claim. Before the plan used them, these were re-checked directly:
- agnix's JSON output;
- every dependency license;
- the Claude CLI flags;
- Codex's loader tests.

### A research track missed the most important comparable

The landscape track did not find Atlan's open AI Registry spec, the closest prior art to ctxlock. The keynote track found it.

*Cause:* each track saw only its own sources.

*Cost:* none, because the synthesis caught it. But a design built from the landscape report alone would have missed it.

*Changed:* the synthesis cross-checks each track's comparables against the other tracks.

## Design

### A PR check that could not see what it was built to catch

The first draft ran 40 eval cases × 3 runs on every PR. That only detects pass-rate swings of about 10 points or more, while the harms that motivate the product are usually 0.5–3 points.

*Cause:* the suite was sized by intuition, not by statistical power.

*Cost:* none in code, because the builder check caught it before anything was built.

*Changed:* PR checks lead with large, cheap signals: probes, which units loaded, and cost. Statistics run on a schedule or a label. The phase 1 exit criteria now use planted edits large enough to detect.

### Naming the project before checking the name

The folder was named `ContextFS` before anyone checked the name. contextfs.ai turned out to be a paid product in the same category, holding the GitHub org and the PyPI name.

*Cost:* a rename, made before anything was published.

*Changed:* the name is checked on GitHub, npm, PyPI, crates.io and via domain RDAP lookups before anything is published under it.

## Planning

### Planning around tools that weren't there

The first plan assumed Docker containers, the Codex CLI, and API keys for both Claude and OpenAI. None of those was available: Satyam has Claude Code on a Max subscription, and that's all.

*Cause:* the available tooling wasn't asked about before runtime work was planned. Installed tools were checked, but access to paid APIs was assumed.

*Cost:* one revision of both the design and the plan.

*Changed:*
- Satyam's tooling is saved to memory.
- Runtime work now uses `claude -p`, throwaway copies, run-scoped hooks and observe-and-deny probes.
- Codex is checked against its own open-source tests.
- Budgets are counted in runs, not dollars.

### Two things with the same name

The plan's first draft had both a `Codeowners.ownersOf(path)` method and an exported `ownersOf(unit, …)` function.

*Cost:* none, because the plan's self-review caught it.

*Changed:* the function was renamed `unitOwners`.

## Verification

### A clean scan that never ran

Before the first commit, a scan for hidden Unicode reported "none". It had not actually run: grep failed on the Windows locale, and the command's `|| echo "none"` fallback printed the same word a real clean result would have.

*Cause:* the failure path and the success path printed the same thing.

*Cost:* a false all-clear, caught within a minute because the output looked too quick.

*Changed:*
- Scans check the exit code explicitly (1 = no match, 2 = error).
- Every scan gets a **positive control**: a planted U+200B the scan must catch.

### The tool that wrote invisible characters into our own source

While mutation-checking Task 2, one planned mutation would not apply: its find-and-replace string, a unicode escape for U+FEFF, did not match the source. The file actually contained a **raw BOM character**, not the six-character escape that was written. The file-writing tool turns `\uXXXX` escapes for invisible characters into the characters themselves. A first attempt at a guard test, written with escaped ranges in a regex, became a file full of raw zero-width and bidi characters too.

*Cause:* a tool behaviour nobody knew about. It matters more for ctxlock than for most projects, because L1, the lint rule that catches invisible characters, needs many of them in its tests.

*Cost:* a hidden character sat in `src/units/frontmatter.ts` for about ten minutes. It was caught only because a mutation refused to apply.

*Changed:*
- Invisible characters are now always built from numeric code points (`String.fromCodePoint(0x200b)`, `charCodeAt(0) === 0xfeff`).
- `tests/hygiene.test.ts` fails the build if any file under `src/` or `tests/` contains one. It was checked both ways: planted U+200B and U+E0001 both fail it.

The same thinking later caught the scan flagging the plan's own emoji examples. The plan quotes 👨‍👩‍👧 to show legitimate ZWJ sequences, and a naive scan flags those characters. That is why lint rule L1 has an emoji exception.

### A mutation run that "killed" everything against a red baseline

The first mutation run for Task 5 reported 19 of 19 mutations killed. A test added just before it, a nested Claude skill in the budget fixture, was already failing on the unmodified code. So every mutation "failed the tests" whether or not the tests could see it.

*Cause:* the script checked that the tests failed after each mutation, but never checked that they passed before it.

*Cost:* none in the end. The suite output printed one line above the mutation results showed `1 failed`, and the failure turned out to be a real bug (lazily loaded skills reported as truncated).

*Changed:* the mutation script runs the suite unmodified first and stops unless it is green. It is the same lesson as the scan that never ran: a check needs a control that proves it can tell pass from fail.

### A test that could not fail

In Task 4, the test "`@` inside inline code is not an import" passed even with the inline-code handling deleted. Its fixture was `` `@inline.md` ``, with the `@` right after a backtick, and the import pattern only matches an `@` at the start of a line or after whitespace. The test was checking something the code never did.

*Cause:* the fixture was written to look like the case, not to exercise it.

*Cost:* caught by its mutation check, before commit.

*Changed:* fixtures put the `@` where it would otherwise match (`` `pnpm add @x.md` ``).

## Building

### A safety rule enforced at one door out of three

The design says a symlink that leaves the repository is never followed. The reader enforced that when *listing* files, so discovery never saw such a link. But its `readFile` and `exists` methods opened any path they were given, and two callers asked for fixed paths: `ctxlock.yaml` and `CODEOWNERS`. A pull request adding `ctxlock.yaml -> /some/secret` would have had the secret read and parsed, and a YAML error quotes the offending line into the CI log.

*Cause:* the rule was attached to the obvious entry point, the listing, instead of to the reader as a whole. The tests only exercised the listing.

*Cost:* found by the batch-1 review before any release; nothing shipped.

*Changed:* readers now serve only files in their own listing, and discovery follows in-repo links itself (decision D25). A test with a real symlink to a file outside the repo runs on both Ubuntu and Windows.

### Building from research notes instead of the docs

Task 4 predicted Claude Code's loading from the research summary written earlier the same day, not from Claude Code's docs. The plan said to re-verify vendor behaviour at build time; that step was skipped because the notes felt fresh. The review found five rules missing or wrong: skills and rules in parent directories, the reach of the 40,000-character cap, `.claude/AGENTS.md`, nested `AGENTS.md`, and nested `CLAUDE.local.md`. The guide had also claimed "ctxlock follows symlinks inside the repository" when it only followed links that pointed straight at a unit.

*Cause:* a summary was treated as the source, and the guide was written from the intent instead of the code.

*Cost:* one fix pass; the predictions were never released.

*Changed:* before fixing, an agent fetched the docs and quoted each rule with its section, and the fix follows the quotes. Guide claims are checked against code and tests, and its examples are run, not written.
