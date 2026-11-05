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
