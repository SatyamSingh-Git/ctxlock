# 19. Every agent's files, for safety

On 2026-11-22, a strategy review (kept locally as `reports/ctxlock direction and roadmap.md`, not committed) said ctxlock was pointed at the right problem, but in the wrong order. Its pitch is teams that run several agents, yet it saw only Claude Code's and Codex's files. Before more pillars, it said, ctxlock should ship and widen.

The same weekend:
- **The security hole was closed (D106).** A pull request could take a folder out of `knowledge:` and edit what it held unchecked.
- **0.1.0 shipped** on npm and the GitHub Marketplace.
- **This plan** ([plan](../docs/superpowers/plans/2026-11-23-ctxlock-other-agents-safety.md), [design](../docs/superpowers/specs/2026-11-23-ctxlock-other-agents-safety-design.md)) took the cheapest real step toward the multi-agent pitch.

Satyam chose the approach, A of three, and approved the design. The rest were my calls, D107 to D112.

## What exists now

- **The files of nine more agents are units with their own family:** Copilot, Cursor, Gemini CLI, Antigravity, Devin and Windsurf, Kiro, Cline, OpenCode and Kilo, and Junie. Each path was confirmed from its vendor's docs or loader code on 2026-11-23 ([the list, with sources](../the-guide/other-agents.md)).
- **Only the safety checks run on them:** L0, L1, L2, L10 and L15.
  - A hidden character in a Cursor rule fails the pull request.
  - So does a new MCP server in `.cursor/mcp.json`, or any edit to `copilot-setup-steps.yml`.
- **Execution config is read server by server only where the format is documented.** Everything else is opaque: any edit counts.
- **The Claude Code and Codex predictions are unchanged.** A test scans one of every new file type and compares the predictions with and without them.
- **The suite has 854 tests.**

## What worked

**Confirming paths before writing patterns.** A researcher checked every path and format against current docs and loader code. Two of my planned paths did not exist (`.windsurf/mcp_config.json` and `copilot-setup-steps.yaml`). Four agents' hook formats are unlike Claude's. And it found repository paths that run code that nobody had listed: OpenCode's and Kilo's `plugin` and `tool` folders, Cline's hook scripts, and Kiro's custom agents. Guessed parsers would have hidden changes in exactly those files.

**A live scan of a public repository** ([zoxknez/ai-coding-rules](https://github.com/zoxknez/ai-coding-rules), MIT) caught two things the tests had not. Both are now fixed with tests:
- **A false finding.** `L0-frontmatter` flagged a Cursor rule because strict YAML rejected a second colon in its description. ctxlock does not model Cursor's parser, so the finding claimed something it did not know (D111).
- **A missing feature.** `scan` did not show a unit's agent at all, though the design said it would.

After both fixes, the same repository gives:

```text
$ ctxlock diff --base 8f37f1d^ --head 8f37f1d .
ctxlock diff 8f37f1d^ -> 8f37f1d
no must-fix issues

Changed units:
  added     instructions/.clinerules
  modified  instructions/.github/copilot-instructions.md
  added     rule/.cursor/rules/94-multimodal-context.mdc
```

**Mutation checks found dead code.** The design asked `inventory()` to refuse other agents' files explicitly. When I removed that guard, every test still passed: the caller already routes those files elsewhere before `inventory()` sees them. So the guard was removed. The routing is what makes the guarantee, and a mutation on it fails three tests.

## What broke, and what it taught

- **Two of my plan's expectations about today's behaviour were wrong:**
  - A symlink to a unit is already an alias (so imports through it resolve), which my plan said it was not.
  - A `CLAUDE.md` importing `@GEMINI.md` already loads it once the file exists.

  Both tests were corrected to pin today's behaviour, which was the point. Lesson: check the current output before writing "as today" into a test.
- **The design was wrong about `.mdc` frontmatter** (D111). It came from reading formats as if every agent parsed YAML strictly. Only a real repository showed otherwise.

## What is next

- **Predicted loading for Copilot, then Cursor, OpenCode and Gemini.** The research notes already hold their loading rules.
- **Still not read:** the hooks in Claude Code's `.claude/settings.json` that Copilot CLI, Cursor and Devin CLI also run. ctxlock already checks that file for Claude Code, so a change there is still caught; only the report's wording is narrower than the truth.
