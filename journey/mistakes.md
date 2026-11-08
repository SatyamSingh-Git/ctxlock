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

### A hand-written markdown scanner guarding a security rule

L1 flags HTML comments because reviewers can't see them. Whether a comment is visible depends on whether it sits in code, and Task 6 decided that with a small scanner of its own: a fence was three backticks at the start of a line. CommonMark has more rules than that. A fence inside a list item ends when the item does. A line of backticks with a backtick in its info string is not a fence at all. The batch-2 reviewer used both, checked against GitHub's renderer, to hide a comment that ctxlock never reported. The same scanner also called comments inside indented code "hidden", which is wrong in the other direction.

*Cause:* the project's own rule is to reuse rather than invent, and it was skipped for a piece that looked too small to need a library. For a security check, "what GitHub renders" is the specification, and only a real CommonMark parser implements it.

*Cost:* found by the batch-2 review, before any release.

*Changed:* markdown-it (MIT), a CommonMark parser, now finds code blocks for every rule that cares: imports, comments, overviews, instruction counts and stale paths.

### Allowlist exceptions with room in them

The L1 exception for subdivision flags allowed any 1–7 tag letters between the black flag and CANCEL TAG, because that is the shape of the England flag. That shape is a container: seven hidden letters per flag, and flags can be chained into a sentence. Only three such flags are recommended for display.

*Cause:* the exception described the *format* of the legitimate case instead of listing the cases.

*Cost:* found by the batch-2 review; re-graded from minor to important, since it is a way past a `must` rule.

*Changed:* only England, Scotland and Wales pass. The marker-comment exception added in the same fix pass was written the same way: an exact grammar with no room for a sentence.

### Shell edits that silently did nothing

Several edits this batch went through `sed` and heredocs on Windows. Several of them changed nothing: escaped regex characters or `\n` sequences didn't survive the shell. Each time, the next step only worked because a `grep` afterwards showed the edit was missing.

*Cause:* a substitution that matches nothing is not an error in `sed`.

*Cost:* minutes each time, and one mutation run whose pattern was wrong.

*Changed:* multi-line edits go through the Edit tool, or a script that throws when its search text is not found exactly once.

*Since:* it happened again in Task 14. A Node script fed through a heredoc lost the backslashes in its search strings, and its not-found guard stopped it before it wrote anything. The guard is what made this a non-event.

### Half a parser

Batch 2's fix for the comment rule moved code-block detection to markdown-it, a CommonMark parser, and left inline code to a line-based regex. The batch-3 review found the next way past in that half. `` \`<!-- … -->\` `` renders as a hidden comment between two literal backticks, but the regex read it as code. A backtick inside an HTML attribute did the same.

*Cause:* the fix replaced the part the review had shown to be broken, rather than everything that answered the same question.

*Cost:* found by the batch-3 review, graded critical, before any release.

*Changed:* inline spans now come from markdown-it's own `backticks` rule, with their positions mapped back to the file, so one parser answers "is this code?" for blocks and spans alike.

### Counting findings from memory

The first draft of the dogfood report said 132 findings before the fixes, 96 after, ten false positives left, and 13 stale component paths. Recounting from the saved lint output before committing gave 131, 98, seven, and 7 + 4: four of the "component" paths were files deleted from a folder that still exists, not moved.

*Cause:* the summary was written from the analysis as remembered, after an hour of reading findings, rather than from the output files.

*Cost:* none; caught before the commit.

*Changed:* every number in a report is read from the saved output (`grep -c`) and checked before the commit, and each claim about a file is checked against the file list.

*Since:* the same check caught three more before their commits: a test count (266 for 265) in chapter 7, a package count that was npm's change since the last install rather than a total in the S1 memo, and "9 of 9" predictions where there were 8 in the S4 memo. Each was written before being counted. The behavioral dogfood report's draft then said 75 runs and $2.27 before the last run had finished (it was 73 runs, and only 32 of them report a cost: $0.81), and gave a unit size from an older commit. Both were written to fill a gap, and both were caught by reading the saved output before the commit.

### Code written while the tests were busy

In Plan 2, a mutation run held the eval tests for ten minutes at a time. Rather than wait, the next tasks' code went in alongside their tests, and four times the tests were not run first: the run-scoped hook, the report renderer and CLI command, `probe draft`, and the Action's new steps.

*Cause:* treating the wait as idle time, and writing the code and its tests together in it.

*Cost:* each test then had to be shown failing after the fact, against a stub or the committed file: a no-op hook, a renderer returning nothing, the previous `cli.ts` and `action.yml`. All of them failed as they should, and the slips are in the ledger.

*Changed:* tests come first even when a run is in the way. Work that fits the wait is docs and work on files the run does not load, and anything else waits.

*Since:* once more, in the final review's fix pass, with no run in the way: the check that stops `probe draft` when a call gets past the hook went in with the same check in `eval`, before its own test. Removing it made the new test fail as it should. The habit is copying a fix to its second caller without asking whether the second caller has a test.

### Asking for a push that was already allowed

Sixteen commits, about eight hours of work, sat unpushed while each final message asked Satyam whether to push. They had already said, in Plan 1's first days, to push after every task. A plan step saying "ask Satyam before pushing" was read as overriding that.

*Cost:* those eight hours of work went untested on GitHub's Ubuntu and Windows runners, and Satyam had to say it again.

*Changed:* the memory now says the standing instruction is the approval, and a plan's "ask first" applies to anything other than a push to `main`. Tasks 1–8 were pushed as each finished, after a green `npm run ci` on exactly what was committed.

### A command line has a length

`probe draft` passed its prompt to `claude -p` as an argument. The prompt holds the unit's text. The first live draft, on a repository with a 38 KB `AGENTS.md`, stopped with `spawn ENAMETOOLONG`, because Windows allows 32,767 characters on a command line.

*Cause:* the tests' prompts were all short, and Linux allows far more per argument, so neither CI nor the stand-in for Claude Code could have shown it.

*Cost:* one failed draft, found on the first real repository.

*Changed:* prompts go to Claude Code on stdin, checked live first with a 40,121-character prompt. A test sends 40,000 characters and asserts that none of them are in the arguments.

### Two claims about tools, written from memory

Two lines in the Plan 2 docs described other tools from memory, and both were wrong:
- "An npm install of Claude Code has a `cli.js` to pass to `--claude`." `npm view` shows the package installs a native `bin/claude.exe`.
- "Pull requests against the same base share the eval cache." GitHub scopes caches by branch, so a pull request can restore only its own caches and its base branch's.

*Cause:* the same as "Building from research notes instead of the docs": a plausible statement about someone else's software, not checked against it.

*Cost:* none; both were checked and corrected before the docs were pushed.

*Changed:* nothing new; the rule already existed. Both slips were caught by applying it before pushing, not after.

### A mutation run that ran no tests

Checking the new no-agent-text test for the CLI, the mutation script reported the mutant as surviving. The test was fine. The script passed `-t 'no agent text'` to vitest through `cmd.exe`, which does not treat single quotes as quotes, so the name filter matched no test. vitest ran nothing, exited 0, and the "green baseline" and the "survivor" both meant nothing.

*Cause:* treating exit 0 as "the tests passed", when it can also mean "no test ran".

*Cost:* one debugging round. The earlier mutation runs passed only file paths, so their results stand.

*Changed:* the mutation script now reads how many tests the baseline ran, and refuses to go on when it is 0.

### Trusting the file list as the whole truth about the disk

`ctxlock build` decided where it could write from the same file list it reads context from: what git lists. The final review showed three ways the disk differs from that list:
- a symlink or Windows junction that `.git/info/exclude` hides is not listed, and `--fill-missing` wrote through one to a folder outside the repository;
- git ignores files by rules that are not in any listed `.gitignore`: `.git/info/exclude`, global excludes, and a pattern that matches one file of a copy rather than its folder;
- a skill's file list holds each file's real path, so a file reached through a symlink inside the skill was copied to a path made from the wrong string.

*Cause:* the file list is the right model for reading, since it is what a commit holds and what an agent in CI sees. Writing touches the disk, which also holds what the list leaves out.

*Cost:* pushed to `main` in `b4712d0`; the reviewer reproduced each case on a throwaway repository. No one else had run it.

*Changed:* each write checks the disk itself, every part of the path, for a link. Git says what it ignores, through `git check-ignore`, instead of ctxlock reading `.gitignore` files the way it guesses git does. A skill with linked files is left to a person.

### Three pushes on a red CI

M5 made `--suggest-index` compute the folder's path from the repository's top with `path.relative`. GitHub's Windows runner gives its temp folder by its 8.3 short name (`C:\Users\RUNNER~1\...`), and git gives the top by its long one, so every folder looked outside the repository. CI on `main` went red with M5, and M6 and a docs commit were pushed on top of it before anyone looked.

*Cause:* each push was checked by local gates only, on a machine whose temp path has no short name. Nothing looked at the CI run that each push started.

*Cost:* three commits on a red `main`, found when the live pull request test was about to start.

*Changed:* the directory and the folder are compared by real path (`realpathSync.native`, which expands 8.3 names and follows links), with a test that gives the directory by its short name on Windows and by a symlink elsewhere. After each push, the CI run it starts is watched to the end.

### Backticks in a shell-quoted script ran as commands

During Plan 5, an edit to the commands guide went through `node -e`, with the new markdown inside bash double quotes. Bash ran each backticked span as a command before node saw the script. About twenty stray commands ran, and all failed harmlessly (`command not found`, `Is a directory`). Node then wrote the guide with those spans missing.

*Cause:* the edit was sent through a shell when the file-editing tool was right there. The note already kept was about backslashes in heredocs. Backticks and `$` are the same hazard.

*Cost:* nothing shipped. `git diff` showed the damage, and `git checkout` restored the file before any commit. But the stray commands were whatever the text happened to contain, and they could as easily have been destructive.

*Changed:* text that holds backticks, `$` or backslashes is written with the Edit or Write tool, never inside a shell string.
