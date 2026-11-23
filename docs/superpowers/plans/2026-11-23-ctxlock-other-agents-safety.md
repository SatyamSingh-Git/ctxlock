# Safety Checks for Every Agent's Files: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctxlock` discovers the instruction, rule, skill and execution-config files of nine more agents and runs its safety checks on them. Its Claude Code and Codex predictions do not change.

**Architecture:**
- New unit families, gated by one list, `MODELLED_FAMILIES`.
- `resolveAll` and the lint runner see only modelled units, except in the safety rules and L15.
- L2 gains an opaque inventory item that fingerprints a whole file, so any edit to an execution file whose format ctxlock does not read counts as a change.

**Tech Stack:** TypeScript (Node 22, ESM), vitest, picomatch, jsonc-parser. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-11-23-ctxlock-other-agents-safety-design.md](../specs/2026-11-23-ctxlock-other-agents-safety-design.md). It is approved; read it before starting.

## Global Constraints

- **Predictions:** Claude Code and Codex output must stay byte-for-byte the same. All 751 existing tests pass unchanged.
- **Fail closed:** when ctxlock cannot read a format, any edit to the file counts as an execution-affecting change.
- **Sources:** every new path is confirmed from the vendor's docs or loader code before it is added. A path that cannot be confirmed is left out and recorded as a gap.
- **D30 and D106 stand.** Nothing added here may let the head decide what is checked.
- **No new dependencies.**
- **Process:**
  - Every test is checked in both directions and mutation-checked.
  - Run tests from PowerShell, or from `/F/ContextFS` in Git Bash.
  - Push after each task, once `npm run ci` is green.

## Review Focus

1. **A CRLF checkout of an opaque file** gives the same fingerprint as an LF checkout, so it is not a change. Tested in Task 3.
2. **A folder name in another case**, such as `.Cursor/mcp.json` or `.GITHUB/hooks/x.json`. Windows and macOS read it as the same folder, so the new config patterns match case-insensitively. Tested in Task 2.
3. **An empty or non-UTF-8 file** in a rules folder gives `L0-encoding` and no crash. Tested in Task 2.
4. **`.clinerules` as a single legacy file and as a folder** are both discovered. Tested in Task 2.
5. **A `.mdc` rule with no frontmatter** is still a rule and gives no `L0-frontmatter`. Tested in Task 2.

---

### Task 1: The family gate

Families exist, `resolveAll` and the lint runner gate on them, and both agent models also filter by family. No new files are discovered yet, so every check works on units built in the tests.

**Files:**
- Modify: `src/model.ts`. Extend `Unit['family']` and add `MODELLED_FAMILIES`.
- Modify: `src/harness/resolve.ts`. `resolveAll` filters units.
- Modify: `src/harness/claude-code.ts`. Rules are family `claude`; skills are family `claude` or `agents`.
- Modify: `src/harness/codex.ts`. Skills are family `claude` or `agents`.
- Modify: `src/lint/run.ts`. Gate rules by family.
- Test: `tests/harness/resolve.test.ts` (create if absent; otherwise add to `tests/harness/claude-code.test.ts`), `tests/lint/run.test.ts`.

**Interfaces:**
- Produces:
  - `type Family = 'agents-md' | 'claude' | 'agents' | 'codex' | 'vscode' | 'okf' | 'ossie' | 'copilot' | 'cursor' | 'gemini' | 'antigravity' | 'devin' | 'kiro' | 'cline' | 'opencode' | 'junie' | 'other'`
  - `Unit['family']: Family`
  - `export const MODELLED_FAMILIES: ReadonlySet<Family>`, holding the first seven values above
  - `export const modelled = (u: Unit) => MODELLED_FAMILIES.has(u.family)`
  - `export const FAMILY_NAMES: Record<Family, string>`, the display names used in messages: `copilot: 'Copilot'`, `cursor: 'Cursor'`, `gemini: 'Gemini CLI'`, `antigravity: 'Antigravity'`, `devin: 'Devin'`, `kiro: 'Kiro'`, `cline: 'Cline'`, `opencode: 'OpenCode'`, `junie: 'Junie'`, `other: 'other agents'`, and the existing families by their agent names.
  - All of these live in `src/model.ts`.

- [ ] **Step 1: Write the failing tests**
  - In `tests/harness/resolve.test.ts`, `it('resolveAll gives the agent models only modelled units, so another family adds no site and no entry')`:
    - Discover `{'AGENTS.md': 'a', 'CLAUDE.md': 'c'}` with `memReader`.
    - Append a copy of the AGENTS.md unit with `family: 'cursor'`, `id: 'instructions/sub/AGENTS.md'` and `path: 'sub/AGENTS.md'`.
    - Expect `resolveAll` to return the same contexts as for the discovered units alone: `toEqual`, and no site `'sub'`.
  - In `tests/harness/claude-code.test.ts`, `it('a rule or skill of another family is never loaded or noted')`:
    - Call `resolveClaudeCode` directly with a unit `{kind: 'rule', family: 'cursor', path: '.cursor/rules/x.mdc'}` and a unit `{kind: 'skill', family: 'copilot', path: '.github/skills/s'}`.
    - Expect no entry for either and no note containing `s`.
    - Add the same case for `resolveCodex`.
  - In `tests/lint/run.test.ts`, `it('only the safety rules and L15 see units of other families')`:
    - Build a `LintContext` from `lintContext()`, then append a `cursor` rule unit whose text has a U+200B (`String.fromCodePoint(0x200b)`). Add a `ctxlock.yaml` `units:` entry with an owner for its path.
    - Expect `L1-hidden-unicode` on it.
    - Expect every finding whose `unitId` is the cursor unit's to start with `L1-`, and no `L15-graph` finding.
    - Then drop the owner and expect `L10-owner` to count the cursor unit.

- [ ] **Step 2: Run them and watch them fail**
  - Run: `npx vitest run tests/harness tests/lint/run.test.ts`
  - Expected: FAIL. The `cursor` unit adds a site, a cursor rule is predicted as lazy for Claude Code, and L5 fires on the cursor unit.

- [ ] **Step 3: Implement the gate**
  - Add the `model.ts` exports listed under Interfaces.
  - `resolveAll`: pass `{...input, units: input.units.filter(modelled)}` to `contextSites` and to the resolvers.
  - Family filters in `claude-code.ts` and `codex.ts`, as the spec's section 3 describes.
  - `runLint`: rules in `ALL_UNITS = new Set([hiddenUnicode, htmlComment, riskyInstruction, execConfig, owners, graphRefs])` get `ctx`. Every other rule gets `{...ctx, units: ctx.units.filter(modelled)}`.

- [ ] **Step 4: Run them and watch them pass**
  - Run: `npx vitest run tests/harness tests/lint`
  - Expected: PASS.
  - Then run `npm run ci`. Expected: typecheck clean and every test passes.

- [ ] **Step 5: Mutation-check, then commit and push**
  - Mutate each of these in turn, and confirm one new test fails for each:
    - remove the `resolveAll` filter;
    - remove the family check from `claude-code.ts`;
    - remove it from `codex.ts`;
    - move `owners` out of `ALL_UNITS`;
    - move `graphRefs` out of `ALL_UNITS`.
  - Commit: `feat: unit families, and only modelled ones reach the agent models and content rules`

### Task 2: Discovering other agents' files

**Files:**
- Modify: `src/units/discover.ts`. Add new `PATTERNS` rows, and apply "a modelled path wins".
- Create: `the-guide/other-agents.md`, holding each family's paths, kinds and sources, with access dates.
- Modify: `the-guide/README.md`, linking the new page.
- Test: `tests/units/discover.test.ts`, `tests/scan.test.ts`.

**Interfaces:**
- Consumes: `Family` and `modelled` from Task 1.
- Produces: units of the new families with kinds `instructions`, `rule`, `skill` and `config`. Config units of new families are what Task 3 inventories.

- [ ] **Step 1: Confirm the paths**
  - Check every path in the table below against its source. The research notes give a URL for each: `research_notes/ctxlock direction and roadmap/agent_support_matrix.md`, sections 2.3 to 2.13.
  - Re-check anything those notes mark `[r08]` at its vendor's current page or code.
  - Write `the-guide/other-agents.md` with only the confirmed rows, each with its source URL and access date, and a "Not covered yet" list holding the rest.

  | Family | instructions | rule | skill root (`<root>/<name>/SKILL.md`) | config |
  |---|---|---|---|---|
  | copilot | `.github/copilot-instructions.md` | `.github/instructions/**/*.instructions.md` | `.github/skills` | `.github/workflows/copilot-setup-steps.yml`, `.github/hooks/*.json`, `.github/mcp.json`, `.vscode/mcp.json` |
  | cursor | `.cursorrules` | `.cursor/rules/**/*.mdc` | `.cursor/skills` | `.cursor/mcp.json`, `.cursor/hooks.json` |
  | gemini | `**/GEMINI.md` | | `.gemini/skills` | `.gemini/settings.json` |
  | antigravity | | `.agents/rules/*.md` | | `.agents/hooks.json`, `.agents/mcp_config.json`, `.agents/plugins/*/plugin.json`, `.agents/plugins/*/mcp.json` |
  | devin | `.devin/global_rules.md`, `.windsurf/global_rules.md`, `.windsurfrules` | `.devin/rules/*.md`, `.windsurf/rules/*.md` | `.devin/skills`, `.windsurf/skills` | `.devin/hooks.v1.json`, `.devin/mcp_config.json` |
  | kiro | | `.kiro/steering/*.md` | `.kiro/skills` | `.kiro/hooks/*.json`, `.kiro/settings/mcp.json` |
  | cline | `.clinerules` (as a file) | `.clinerules/**/*.md`, `.cline/rules/**/*.md` | `.clinerules/skills`, `.cline/skills` | `.clinerules/hooks/*`, `.cline/hooks/*` |
  | opencode | | `.kilocode/rules/**/*.md` | `.opencode/skills`, `.kilo/skills` | `opencode.json`, `opencode.jsonc`, `kilo.jsonc` |
  | junie | `.junie/guidelines.md` | | | `.junie/mcp/mcp.json` |
  | other | `**/AGENT.md`, `**/AGENTS.local.md` | | | |

- [ ] **Step 2: Write the failing tests**
  - In `tests/units/discover.test.ts`, use `it.each` over every confirmed row: the file is discovered with the expected `kind`, `family` and `id`.
  - Near misses, which give no unit:
    - `.cursor/rules/x.md`, since Cursor needs `.mdc`;
    - `.github/skills/a/b/SKILL.md`, one level too deep;
    - `.github/workflows/ci.yml`.
  - `it('matches other agents\' config folders in any case, as Windows and macOS do')`: `.Cursor/mcp.json` and `.GITHUB/hooks/x.json` are config units.
  - `it('a modelled path wins: a .claude link to another agent\'s file keeps today\'s unit')`:
    - symlink `.claude/skills/x` to `.github/skills/x`;
    - expect exactly the units discovered today, namely `skill/.claude/skills/x` with family `claude`, and no `copilot` unit.
    - Repeat for `.claude/rules/r.md` linked to `.cursor/rules/r.mdc`, and for `.github/skills/x` linked to `.claude/skills/x`, which gives no alias.
  - `.clinerules` as a file is an `instructions` unit. `.clinerules/a.md` is a `rule` unit.
  - An empty `.cursor/rules/a.mdc` is a rule. Non-UTF-8 bytes give `L0-encoding`. A `.mdc` with no frontmatter gives no `L0-frontmatter`.
  - In `tests/scan.test.ts`, `it('other agents\' files change nothing Claude Code or Codex are predicted to load')`:
    - scan one fixture with every confirmed path, plus a `CLAUDE.md` that imports `@GEMINI.md`;
    - scan the same fixture without the new files;
    - expect `contexts` and `budget` to be equal (`toEqual`).

- [ ] **Step 3: Run them and watch them fail**
  - Run: `npx vitest run tests/units/discover.test.ts tests/scan.test.ts`
  - Expected: FAIL, with no new units discovered.

- [ ] **Step 4: Implement the patterns**
  - Add rows to `PATTERNS` after the existing ones. New `config` globs use picomatch `{ dot: true, nocase: true }`.
  - **A modelled path wins.** Before the main loop, collect `modelledReal`: the real path of every reachable path that a modelled-family row, or `businessPattern`, matches. For a skill, use the real path of its `SKILL.md`. In the loop, skip a path matched by a new-family row when its real path is in `modelledReal`.

- [ ] **Step 5: Run them and watch them pass**
  - Run: `npx vitest run tests/units tests/scan.test.ts`, then `npm run ci`.
  - Expected: PASS everywhere.

- [ ] **Step 6: Mutation-check, then commit and push**
  - Mutate each of these in turn, and confirm a test fails for each:
    - drop `nocase`;
    - remove the `modelledReal` skip;
    - change `**/*.mdc` to `**/*`;
    - remove the `.clinerules` file row.
  - Commit: `feat: discover nine more agents' instructions, rules, skills and config`

### Task 3: Execution config of other agents

**Files:**
- Modify: `src/lint/rules/l2-exec.ts`. Add the opaque `file` item, parse the two MCP files with a catch-all item, treat a parse error as opaque, and dispatch explicitly.
- Test: `tests/lint/l2.test.ts`, `tests/diff.test.ts`.

**Interfaces:**
- Consumes: config units of new families from Task 2; `FAMILY_NAMES`.
- Produces:
  - the `Kind` union gains `'file'`;
  - an opaque item has `key: 'file'`, `value: { digest: unit.files[0].sha256 }` and message ``${path} can change what ${FAMILY_NAMES[family]} runs; ctxlock does not read its format, so any change counts``;
  - a catch-all item has `key: 'rest'`, `value: { rest }` (the object without its servers key) and message ``${path} has settings besides MCP servers; any change to them counts``. It is emitted only when `rest` has a key.

- [ ] **Step 1: Write the failing tests**
  - In `tests/lint/l2.test.ts`:
    - `it('a config file ctxlock cannot read is one item, fingerprinted on its LF content')`: `.github/hooks/a.json` gives one `L2-exec-config` item with `data.kind === 'file'`. The same text with CRLF has the same fingerprint, and different text has a different one.
    - `it('reads MCP servers in .cursor/mcp.json and .vscode/mcp.json, and the rest as one item')`:
      - `{"mcpServers": {"x": {"command": "node", "args": ["s.js"]}}}` gives `MCP server x runs "node s.js"` and nothing else;
      - adding `"other": 1` adds one `rest` item;
      - `.vscode/mcp.json` reads `servers` the same way.
    - `it('a new-family MCP file that does not parse gives L2-parse and an opaque item')`.
    - `it('.vscode/mcp.json is not read as VS Code settings, and an unknown family never falls through to Claude settings')`: a `.gemini/settings.json` holding `{"hooks": {...Claude shape...}}` gives one opaque item and no hook item.
    - `it('a skill of another family has its allowed-tools and hooks inventoried')`: `.github/skills/s/SKILL.md` with `allowed-tools: Bash` gives an `auto-approve` item.
  - In `tests/diff.test.ts`:
    - `it('a hidden character in a Cursor rule fails the diff, and reverting it passes')`.
    - `it('any edit to copilot-setup-steps.yml is an execution-affecting change, and an untouched one is not')`. Base has the file and head edits one step. Then base and head are the same file, one checked out with CRLF.
    - `it('a new MCP server in .cursor/mcp.json fails the diff, and reordering keys does not')`.

- [ ] **Step 2: Run them and watch them fail**
  - Run: `npx vitest run tests/lint/l2.test.ts tests/diff.test.ts`
  - Expected: FAIL.

- [ ] **Step 3: Implement it in `l2-exec.ts`**
  - `inventory(unit, config)` dispatches like this:
    - `vscode` and `codex` stay as they are;
    - `claude` keeps the `.mcp.json` / settings split;
    - for `.cursor/mcp.json` and `.vscode/mcp.json`, call `mcpServers()` on `mcpServers` or `servers`, then add the `rest` item;
    - every other family returns the opaque item.
  - In `execConfig.check`:
    - skip `parseConfig` for opaque files;
    - for a new-family parsed file whose parse fails, record `L2-parse` and then the opaque item.

- [ ] **Step 4: Run them and watch them pass**
  - Run: `npx vitest run tests/lint tests/diff.test.ts`, then `npm run ci`.
  - Expected: PASS.

- [ ] **Step 5: Mutation-check, then commit and push**
  - Mutate each of these in turn, and confirm a test fails for each:
    - fingerprint the raw bytes instead of the LF digest;
    - drop the `rest` item;
    - drop the parse-error opaque item;
    - let an unknown family fall through to `claudeSettings`.
  - Commit: `feat: execution config of other agents counts as changed on any edit ctxlock cannot read`

### Task 4: Docs, the journey and a live check

**Files:**
- Modify:
  - `README.md`: a "Safety checks" column in the agent support table, and a line in the roadmap.
  - `the-guide/rules.md`: a section, "Other agents' files", that names the rules which apply and links `other-agents.md`.
  - `the-guide/github-action.md`: the gate now covers other agents' hooks, MCP servers and setup steps.
  - `journey/decisions.md`: D107 to D112, the calls the spec marks *My call*, plus "a modelled path wins".
- Create: `journey/19-other-agents.md`, the chapter for this plan.

- [ ] **Step 1: Run a live check on a public repository**
  - Clone one public repository that has `.cursor/rules` or `.github/copilot-instructions.md` with `--depth 50` into `F:/ctxlock-live/other-agents`.
  - Run `node dist/cli.js scan` and `lint` on it, and `diff` across a commit that touched one of those files.
  - Record the real output in the chapter, and fix anything wrong it shows, test first.

- [ ] **Step 2: Write the docs**
  - Fill in each file listed above.
  - All output quoted in the docs is real output from Step 1.

- [ ] **Step 3: Verify and push**
  - Run `npm run ci`. Expected: green.
  - Push. Then watch CI with `gh run watch`. Expected: green on Ubuntu and Windows.
  - Commit: `docs: other agents' files in the guide, README and journey`

## Final review (2026-11-24)

A fresh reviewer read 64e7c36..253e269 and returned "with fixes". There were two Criticals and four Importants, all fixed test-first and mutation-checked in a3dc602 and d2bf27c (D113 to D116). The suite now has 877 tests, and CI is green on Ubuntu and Windows.

Deferred minors:
- `copilot-setup-steps.yml` gets the generic opaque message, not the spec's "changes what Copilot's cloud agent runs before it starts" (src/lint/rules/l2-exec.ts).
- A non-UTF-8 asset in a plugin or tool folder, such as a PNG, gives an `L0-encoding` should on every scan (src/units/discover.ts).
- A `.mdc` rule's name keeps its extension, because `basename(path, '.md')` strips only `.md` (src/units/discover.ts).
- One failure in a dated OKF test (tests/scan.test.ts) on a heavily loaded first run, not reproduced since.

Known gaps the reviewer set aside:
- **Hook scripts that a hooks file names** (`.cursor/hooks/x.sh`) are not gated themselves. The same is true for Claude Code in 0.1.0.
- **Gemini's `.gemini/extensions/` and `.gemini/commands/`:** not covered, and not in the path research.
- **A `.cursor/mcp.json` linked to `.mcp.json`** is read only as Claude Code's.
