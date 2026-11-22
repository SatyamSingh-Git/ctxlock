# Safety checks for every agent's files: design

Status: draft for Satyam's approval, 2026-11-23. Revised after a builder check.

## Why

ctxlock is pitched at teams that run several coding agents, but today it only sees the files Claude Code and Codex read. A pull request can add a hidden-Unicode instruction to `.cursor/rules/`, or an MCP server to `.cursor/mcp.json`, and `ctxlock diff` says nothing. The strategy review of 2026-11-22 ([report](../../../reports/ctxlock%20direction%20and%20roadmap.md)) put this first among the "next" items. Making the safety checks see every agent's files is the cheapest real step toward the multi-agent pitch, and attacks through committed agent config are the best-evidenced demand. The Miasma worm spread through config-only commits, and Cursor ran hooks from `.claude/settings.local.json` (CVE-2026-48124).

## Goals

- `ctxlock lint`, `scan` and `diff` discover the instruction, rule, skill and execution-config files of Copilot, Cursor, Gemini CLI, Antigravity, Devin (and Windsurf), Kiro, Cline, OpenCode (and Kilo) and Junie.
- On those files, the safety checks run:
  - `L0-encoding`, `L0-frontmatter` and `L0-symlink-outside`, from discovery;
  - `L1-hidden-unicode` and `L1-html-comment`;
  - `L2-risky-instruction`;
  - the `L2-exec-config` inventory, which feeds the `L2-exec-config-changed` gate in `diff`;
  - `L10-owner`.
- A new or changed hook, MCP server or setup step in any of those agents' config fails the pull request check, as it does for Claude Code and Codex today.
- They appear in `diff`'s changed units and in `scan`'s unit list, with their agent as the unit's family.

## Non-goals

- Predicting what Copilot, Cursor or the others load. There is no per-agent resolver, no budget, no coverage and no shadowing for them. That is the next plan, one agent at a time, starting with Copilot.
- Content rules on their files: L0-skill-spec, L3–L9, L11, L13–L17. They are tuned to Claude Code and Codex, and on other agents' files they would judge things no modelled agent reads.
- Syncing other agents' files with `ctxlock sync`, or evaluating them with `ctxlock eval`.
- User-level files (`~/.cursor`, `~/.gemini`, and so on). ctxlock reads repositories.

## Anti-goals

These would make the change a failure even if it worked:

- **Any change to what ctxlock predicts for Claude Code or Codex.** A Cursor rule must never appear as loaded by Claude Code, and a Copilot skill must never produce a note such as "not visible to Codex: .claude/skills is not scanned". Every existing test keeps passing unchanged.
- **A pull request that slips an execution change past the gate.** It could do so by changing a file ctxlock cannot parse, or by changing a format ctxlock half-understands. When ctxlock is unsure, it fails closed.
- **Guessed parsers.** A format ctxlock models wrongly hides changes. A format it treats as opaque cannot.

## Constraints

- Follows D30 and D106: settings and declared folders come from the base. Nothing here adds a head-only input that decides what is checked.
- No new dependencies. `yaml`, `jsonc-parser` and `smol-toml` are already present.
- Each new file pattern is sourced. Every path comes from the vendor's docs or loader code, with the URL and access date recorded in the guide. The research notes (`research_notes/ctxlock direction and roadmap/agent_support_matrix.md`) are the starting point, and anything they mark `[r08]` (unconfirmed) is checked again before it is relied on.

## Approaches considered

- **A. Units with their own agent family, safety checks only.** *Chosen by Satyam.* Other agents' files become ordinary units with new `family` values. The Claude Code and Codex models select by family as well as kind, so they ignore them. The lint runner runs only the safety rules on families ctxlock does not model. The files then appear in changed units, owners and impact for free, and full support for an agent later means turning more rules on for its family.
- **B. A plain list of files that only L1 and L2 read.** This is a smaller change, but the files would not be units: they would not appear in changed units, CODEOWNERS checks or impact, and the list would be thrown away once agents get full support.
- **C. Scan every file under `.cursor/`, `.github/`, `.gemini/` and similar folders.** There is no list to maintain, but `.github/` holds workflows, templates and issue forms, so every pull request would get noise. Execution config still needs per-format knowledge anyway.

## Design

### 1. Families

`Unit['family']` gains one value per vendor:

- `copilot`
- `cursor`
- `gemini` (Gemini CLI)
- `antigravity` (the `.agents/` rules, MCP, hooks and plugin files)
- `devin` (`.devin/` and the legacy `.windsurf/` and `.windsurfrules`)
- `kiro`
- `cline`
- `opencode` (OpenCode and Kilo)
- `junie`
- `other`, for file names several unmodelled agents share, such as `AGENT.md` (Devin, Kilo, Zed and others) and `AGENTS.local.md` (Devin). *My call:* splitting them by vendor would be a guess, since no single agent owns them.

A single list, `MODELLED_FAMILIES`, names the families ctxlock models today: `agents-md`, `claude`, `agents`, `codex`, `vscode`, `okf` and `ossie`. Every other family is "safety only".

**A modelled path always wins.** *My call*, from the first anti-goal. Today, `.claude/skills/x -> ../../.github/skills/x` gives the unit `skill/.claude/skills/x` with family `claude`, because the real path matches no pattern. If the other agent's pattern were matched first, the real file would become a `copilot` unit, `.claude/skills/x` would become only its alias, the unit's id would change, and Claude Code would drop it. So the new patterns apply only to a real path that no modelled path reaches. A file reachable at both is discovered exactly as today. Its bytes are still in that unit's `files`, so L1 and L2 still read it. The same applies to rules, and to `AGENTS.md` or `CLAUDE.md` linked to another agent's file.

### 2. Discovery

New rows are added to `PATTERNS` in `src/units/discover.ts`, after the existing rows, because order decides the kind. Each row keeps the existing kinds:

- `instructions`: always-on single files, such as `GEMINI.md`, `AGENT.md`, `AGENTS.local.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.devin/global_rules.md` and Junie's guidelines file.
- `rule`: files in a rules folder, such as `.cursor/rules/**/*.mdc`, `.github/instructions/**/*.instructions.md`, `.devin/rules/*.md`, `.windsurf/rules/*.md`, `.kiro/steering/*.md`, `.clinerules/**`, `.cline/rules/**`, `.agents/rules/*.md` and `.kilocode/rules/**`.
- `skill`: `<root>/<name>/SKILL.md` under `.github/skills`, `.cursor/skills`, `.gemini/skills`, `.devin/skills`, `.windsurf/skills`, `.kiro/skills`, `.clinerules/skills`, `.cline/skills`, `.opencode/skills` and `.kilo/skills`.
- `config`: execution config (section 4).

The paths above are the research's list. The final list is whatever the builder confirms from sources. A path that cannot be confirmed is left out and recorded as a gap, never added on a guess.

Frontmatter is split for `rule` and `skill` kinds as it is today. A `.mdc` file has YAML frontmatter, so a broken one gives `L0-frontmatter`.

### 3. The agent models ignore other families

- `src/harness/claude-code.ts`:
  - rules are `kind === 'rule' && family === 'claude'`;
  - skills are units of kind `skill` in families `claude` or `agents`.
  - Instruction files are already selected by file name (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`), so `GEMINI.md` and the others are already ignored. A test pins that.
- `src/harness/codex.ts`: skills are units of kind `skill` in families `claude` or `agents`, so that the existing ".claude/skills is not scanned" note still appears for Claude skills. The instruction chain is selected by file name and needs no change.
- **Both models are given only the modelled units.** `resolveAll` receives `units` filtered to `MODELLED_FAMILIES`, so nothing of another family reaches either model's `byPath`. *My call.* A `CLAUDE.md` that imports `@GEMINI.md` therefore still records a plain `file/GEMINI.md` entry, as it does today, and the entry never points at the `gemini` unit. Claude Code really does load those bytes, and the entry says so. The `gemini` unit gets its safety checks in its own right. This one filter also makes the family checks above a second safeguard rather than the only one.

### 4. Execution config

Each new config file is one of two types.

- **Parsed.** The file's format is confirmed from the vendor's docs or code. Each MCP server is inventoried with the existing `mcpServers()` helper. **Everything else in the file is one catch-all item**, fingerprinted over all the other top-level keys. A key ctxlock does not know about, or a new one, therefore still counts as a change. *My call*, from the fail-closed anti-goal: the existing readers ignore keys they do not know, and that is acceptable only where ctxlock mirrors an agent it models. This round, parsing is only for files whose whole purpose is MCP servers, each to be confirmed:
  - `.cursor/mcp.json` (`mcpServers`);
  - `.vscode/mcp.json` (`servers`).
- **Opaque until a later plan models them.** *My call.* These hold many keys that run code: opencode's `plugin`, `permission`, `formatter`, `lsp` and `command`; Gemini's `tools.discoveryCommand` and `tools.callCommand`. Enumerating them now would be a half-understood format. Fingerprinting the whole file gives the same gate, with less specific messages:
  - `.gemini/settings.json`;
  - `opencode.json`, `opencode.jsonc` and `kilo.jsonc`. These include `instructions` URLs, which a remote server can change without any commit.
- **Opaque.** Its format is not confirmed. The whole file is one inventory item of a new kind, `file`. Its fingerprint is the file's digest (LF-normalised, as units already are), and its message is `<path> can change what <agent> runs; ctxlock does not read its format, so any change counts`. Any edit, including a reformat, is therefore an execution-affecting change. That is fail-closed by design, and a team can downgrade `L2-exec-config-changed` in the base `ctxlock.yaml` as today. The likely opaque files:
  - `.github/workflows/copilot-setup-steps.yml`, which runs in the Copilot cloud agent's environment before it works;
  - `.github/hooks/*.json`;
  - `.github/mcp.json`;
  - `.devin/hooks.v1.json`;
  - `.devin/mcp_config.json`;
  - `.agents/hooks.json`;
  - `.agents/mcp_config.json`;
  - `.kiro/hooks/*.json`;
  - `.kiro/settings/mcp.json`;
  - `.junie/mcp/mcp.json`;
  - Agent Plugins files, `plugin.json` and `mcp.json`, under `.agents/plugins/`.

`inventory()` in `l2-exec.ts` dispatches on family and path explicitly. Today, any config file that is not VS Code or Codex falls through to the Claude settings reader, and that fall-through must not catch the new families. A new parsed file that fails to parse gives `L2-parse` as today. It is then also inventoried as opaque, so that a pull request cannot hide a change behind a syntax error. *My call:* this applies to the new families only. The files ctxlock already reads (`.claude/settings.json`, `.mcp.json`, `.codex/*` and `.vscode/settings.json`) keep their current behaviour, which follows each agent's own parser: VS Code applies what it can read around an error, and ctxlock inventories the same partial value. Changing them is outside this design.

Skill frontmatter (`hooks`, `allowed-tools`) is inventoried for skills of every family, as it already is for `.agents/skills`. That is conservative: a field another agent ignores costs a review, never a missed change.

### 5. The lint runner gates rules by family

`runLint` runs a rule on the full unit list only if it is a safety rule (`hiddenUnicode`, `htmlComment`, `riskyInstruction`, `execConfig` and `owners`) or judges `ctxlock.yaml` itself (`graphRefs`, L15). *My call:* L10 tells a user to name an owner under `units:` in `ctxlock.yaml`. If L15 saw only modelled units, following that advice would trigger "ctxlock.yaml lists X, which is no unit". Every other rule gets the same context with `units` filtered to `MODELLED_FAMILIES`. `contexts` already contain only modelled units once section 3 is in place. Discovery problems (`L0-*`) are reported for every unit, as now.

### 6. What a user sees

- `scan` lists the new units, with their family.
- `lint` reports L0, L1, L2 and L10 findings on them.
- `diff` shows them in changed units, fails on a new must finding in them, and lists their execution-affecting changes. For an opaque file, the listing reads as "changes what Copilot's cloud agent runs before it starts".
- The guide's rules page gets a section, "Other agents' files", that lists each family's paths with sources and says which rules apply. The README's agent support table gets a "safety checks" column.

### 7. Tests

These are the behaviours that must be pinned, each checked in both directions and mutation-checked:

- Each new path is discovered with the right kind and family. A near-miss is not: a `.md` file in `.cursor/rules` (Cursor ignores it), or `SKILL.md` one level too deep.
- A hidden character in a `.cursor/rules/*.mdc` file fails `diff`, and reverting it passes.
- A new MCP server in a parsed file is an execution-affecting change, and reordering its keys is not.
- Any edit to an opaque file is an execution-affecting change. An unchanged opaque file is not, across base and head, and across CRLF and LF checkouts.
- A parsed file broken by a syntax error is still reported as changed.
- Claude Code and Codex predictions are byte-for-byte unchanged on a repository that holds every new file type. The test compares `scan --format json` contexts with and without the new files.
- L3–L9, L11, L13, L14, L16 and L17 report nothing on a repository that holds only other agents' files. L10 does report there. A `units:` entry in `ctxlock.yaml` that gives one of those files an owner clears L10, and L15 does not report it.
- A symlink from a modelled path to another agent's file keeps today's unit id, family and Claude Code prediction.
- A `CLAUDE.md` importing `@GEMINI.md` gives the same `contexts` output as before the change.
- An unknown top-level key added to a parsed MCP file is an execution-affecting change.
- D30 and D106 still hold: a pull request cannot drop an agent's folder out of what is checked. Discovery here is path-based, with no head-side declaration, so there is nothing to drop. A test pins that.

## Left to the builder

- Confirming each path and format from sources, and recording them in the guide.
- Whether `.clinerules` as a single legacy file and as a folder are both supported. Cline supports both, per its docs.
- The exact messages, following the existing style.
- How the guide's per-agent table is laid out.
