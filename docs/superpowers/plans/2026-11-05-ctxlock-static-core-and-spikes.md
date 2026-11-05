# ctxlock Static Core + Phase 0 Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ctxlock scan | lint | budget | diff` and a GitHub Action. For any repo's existing agent context, they report what Claude Code and Codex will load, where it breaks their limits, and which changes are unsafe. Also run the four Phase 0 spikes that de-risk behavioral evals.

**Architecture:**
- A `RepoReader` hides whether we read the working tree or a git ref.
- Discovery turns context files into content-addressed `Unit`s.
- Per-harness resolvers, one file per harness, with limits as data, predict each harness's effective context at every "context site".
- Lint rules read units plus effective contexts, and `diff` compares two scans.
- Nothing is written into the scanned repo, and nothing leaves the machine.

**Tech Stack:** TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, ignore, picomatch, tinyglobby, smol-toml, vitest. The Action reuses marocchino/sticky-pull-request-comment@v3. agnix is optional, via `npx`. All of these were license-checked on 2026-11-05: MIT, ISC, Apache-2.0 or BSD-3-Clause.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1–5 | Done; fixes from the batch-1 review are in | `55a0b4f`..`87da695` |
| 6 | Done | `2822b38` |
| 7 | Done | `a1d8e08`, `262bb06` |
| 8 | Done | `acbf862`, `823324b` |
| 9 | Done | `9f3a576`, `061d3ac` |
| 10 | Done | `feat: lint stale references, ownership, harness coverage and shadowed AGENTS.md` |
| 11–14, S1–S4 | Not started | |

As built, a task sometimes goes further than its text below, because a vendor's current docs or source said otherwise. Each of those calls is in [journey/decisions.md](../../../journey/decisions.md), and each rule's behaviour as built is in [the-guide/rules.md](../../../the-guide/rules.md). The stack differs in two places: there is no tinyglobby (D17), and jsonc-parser 3.3.1 (MIT) reads VS Code's JSONC settings (Task 7).

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md). The harness behaviour it relies on is in [research/08-agent-runtime-internals.md](../../../research/08-agent-runtime-internals.md).

**Scope:**
- **In this plan:** the design's §6 Phase 0, plus the *static* half of Phase 1: scan, lint, budget, static diff, and the Action.
- **Next plan:** the *behavioral* half of Phase 1 gets its own plan once the S1–S4 memos exist. That covers probes, paired evals, collectors, `build --fill-missing`, and the behavioral diff in the Action. Two design decisions are made by those spikes: S1 picks the runner substrate, and S2 picks the rulesync integration mode.

**Deliberate deviations from the design** (each is small, and the reason is given):
- **agnix is an opt-in adapter, not a required dependency** (Task 11). Native L0 covers the skill-spec checks that discovery depends on.
- **`config` kind.** The design's `mcp` and `hook` unit kinds are represented as one `config` kind in Phase 1, and L2 classifies what is inside. They split in Phase 2, when distribution starts.
- **L8 is `info`, not `should`.** Its heuristic gets promoted once evals can validate it.
- **L11 is broadened to "harness coverage gap"**, and a new **L13** flags the most common multi-agent pitfall: CLAUDE.md shadowing AGENTS.md in Claude Code.
- **L12 (LLM contradiction check) moves to the next plan.**
- **Two L3 checks are dropped.**
  - "Trigger words front-loaded" has no objective static test. Plan 2's trigger probes measure it directly.
  - Claude Code's aggregate 1%-of-window listing budget is dropped because the docs leave its unit (characters or tokens) ambiguous. Only the verified per-entry 1,536-character cap is checked.

## Global Constraints

- **Names:**
  - npm package and CLI: `ctxlock`
  - registry: `ctxlock.yaml`
  - lockfile: `ctxlock.lock` (not created in this plan)
  - local state: `.ctxlock/`
- **Licensing:** Apache-2.0. Runtime dependencies must be MIT, Apache-2.0, ISC or BSD. Never AGPL, BSL, ELv2, SSPL or unlicensed.
- **Platform:** TypeScript, ESM, `"engines": { "node": ">=22" }`. Keep `"private": true` in package.json until Satyam decides to publish.
- **No migration, no writes:** "Native formats are the source of truth. Phase 1 needs no migration." The static core never writes into the scanned repo.
- **No content leaves the machine:** "Collectors store IDs and digests only, never content." "Nothing executes from units during scanning."
  - No network calls, except opt-in `--agnix`.
  - JSON and Markdown output never include unit text, only paths, IDs, digests and finding messages.
- **Harness limits as data:** limits live in `src/harness/limits.ts`, each with its source URL and "verified 2026-11-05". The design says "re-verify them against current docs when building, because harness limits change often."
- **Severity and exit codes:**
  - `must` fails CI (exit 1); `should` and `info` are advisory.
  - Exit 2 means a usage or config error.
- **Paths:** repo-relative POSIX paths (`/`) everywhere, including on Windows. CI runs on ubuntu-latest and windows-latest.
- **Git:** work on `main` unless Satyam asks for a branch (CLAUDE.md). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Code style:** read `~/.claude/code-style.md` before writing code.
- **Tests:** every test must be seen failing before its code exists. Every test is mutation-checked: break the code it covers, and watch it fail.
- **Before the final push:** run `npm run ci`, which is typecheck + test + build.
- **Build environment** (Satyam, 2026-11-05):
  - Claude Code only, through the `claude` CLI on a Claude Max subscription. No API keys.
  - No OpenAI or Codex access.
  - No Docker.
  - Every runtime experiment uses `claude -p`. Codex behaviour is only ever predicted.
- **Journey and guide** (Satyam, 2026-11-05):
  - At each batch end (after Tasks 5, 10 and 14) and after each spike memo, add a chapter to `journey/` and update `journey/decisions.md` and `journey/mistakes.md`.
  - Each guide page ships with its feature, and describes only what exists:

    | Task | Guide page |
    |---|---|
    | 3 | `the-guide/configuration.md` |
    | 4–5 | `the-guide/agents.md` |
    | 6–10 | `the-guide/rules.md` (each task adds its own rules) |
    | 11 | `the-guide/installation.md` and `the-guide/commands.md` |
    | 12 | `diff` added to `the-guide/commands.md` |
    | 13 | `the-guide/github-action.md` |
    | 14 | `the-guide/troubleshooting.md` |

## Review Focus

These are the conditions most likely to break real users. Each line names the task whose tests pin it.

1. **Shallow CI clone or missing base ref.**
   - Condition: `diff --base <sha>` on a `fetch-depth: 1` checkout.
   - Expected: exit 2 with `base ref <sha> not found — in GitHub Actions use actions/checkout with fetch-depth: 0`. No crash, and no "everything added" report.
   - Pinned in: Task 12.
2. **Windows checkouts.**
   - Condition: CRLF files and `\` paths.
   - Expected: frontmatter parses with CRLF; byte budgets count bytes as stored on disk; IDs use `/`.
   - Pinned in: Tasks 1, 2 and 5.
3. **Symlinked skill mirrors.**
   - Condition: `.claude/skills/x → ../../.agents/skills/x`, the usual fix for Claude Code not reading `.agents/skills`.
   - Expected: one unit, visible to both harnesses, not a duplicate. A symlink that leaves the repo is never followed.
   - Pinned in: Tasks 2 and 9.
4. **Malformed input.**
   - Condition: invalid YAML frontmatter, invalid JSON or TOML in settings, non-UTF-8 bytes, empty files, unknown keys in `ctxlock.yaml`.
   - Expected: a finding or a clear exit-2 message, never a stack trace.
   - Pinned in: Tasks 2, 3 and 7.
5. **Legitimate Unicode.**
   - Condition: emoji ZWJ sequences (👨‍👩‍👧), VS16 (❤️), CJK text, and RTL text that uses LRM/RLM.
   - Expected: no `must` finding. Only zero-width characters, bidi overrides and isolates, and Tag-block characters are `must`.
   - Pinned in: Task 6.

---

## File Structure

```
package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
.gitattributes          # * text=auto eol=lf
.gitignore              # node_modules/ dist/ .ctxlock/
.github/workflows/ci.yml        # ubuntu + windows, Node 22, npm run ci
.github/workflows/self-test.yml # runs the Action on this repo's PRs
action.yml                      # composite GitHub Action
src/
  model.ts              # Unit, UnitFile, UnitKind, Finding, Severity, HarnessId
  repo/reader.ts        # RepoReader, fsReader, gitReader, FileNotFound, RefNotFound
  units/frontmatter.ts  # splitFrontmatter
  units/digest.ts       # sha256Hex, unitDigest
  units/discover.ts     # discovery patterns + discoverUnits
  registry/registry.ts  # ctxlock.yaml schema + loadRegistry, RegistryError
  registry/codeowners.ts# loadCodeowners, unitOwners
  harness/limits.ts     # LIMITS with sources
  harness/types.ts      # LoadEntry, EffectiveContext, ResolveInput
  harness/imports.ts    # findImports (Claude @path)
  harness/claude-code.ts
  harness/codex.ts
  harness/resolve.ts    # contextSites, RESOLVERS, resolveAll
  report/budget.ts      # budgetReport
  lint/types.ts         # LintContext, Rule
  lint/run.ts           # RULES, runLint
  lint/agnix.ts         # optional agnix adapter
  lint/rules/l0-skill-spec.ts  l1-hidden.ts  l2-exec.ts  l3-budget.ts
  lint/rules/l4-discoverable.ts  l5-instructions.ts  l6-skill-length.ts
  lint/rules/l7-duplicates.ts  l8-procedure.ts  l9-stale.ts  l10-owner.ts
  lint/rules/l11-coverage.ts  l13-shadowed.ts
  scan.ts               # scanRepo
  diff.ts               # diffScans
  report/render.ts      # text/json renderers
  report/markdown.ts    # renderDiffMarkdown
  cli.ts                # main(argv, io)
tests/helpers/repo.ts   # gitRepo(commits) temp git repos
tests/helpers/mem-reader.ts  # memReader(files, symlinks)
tests/**                # mirrors src/
docs/spikes/            # S1–S4 memos
spikes/                 # throwaway spike code, excluded from the package ("files": ["dist"])
docs/dogfood/           # Task 14 report
```

---

## Part 1: Static core

### Task 1: Project scaffold and RepoReader

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitattributes`, `.gitignore`, `.github/workflows/ci.yml`, `src/model.ts`, `src/repo/reader.ts`, `tests/helpers/repo.ts`, `tests/helpers/mem-reader.ts`
- Test: `tests/repo/reader.test.ts`

**Interfaces:**
- Produces (`src/repo/reader.ts`):
  ```ts
  export interface RepoReader {
    readonly root: string;
    readonly ref: string | null;                          // null = working tree
    listFiles(): Promise<string[]>;                       // sorted POSIX paths, never .git/ or node_modules/
    readFile(path: string): Promise<Buffer>;              // throws FileNotFound
    exists(path: string): Promise<boolean>;
    listSymlinks(): Promise<Map<string, string | null>>;  // link path -> repo-relative target; null if it leaves the repo
  }
  export class FileNotFound extends Error { constructor(readonly path: string) }
  export class RefNotFound extends Error { constructor(readonly ref: string) }
  export function fsReader(root: string): RepoReader;
  export function gitReader(root: string, ref: string): Promise<RepoReader>;  // rejects with RefNotFound
  ```
- Produces (`src/model.ts`):
  ```ts
  export type Severity = 'must' | 'should' | 'info';
  export type HarnessId = 'claude-code' | 'codex';
  export type UnitKind = 'instructions' | 'rule' | 'skill' | 'config';
  export interface UnitFile { path: string; bytes: number; sha256: string }
  export interface Unit {
    id: string;              // `${kind}/${path}`
    kind: UnitKind;
    family: 'agents-md' | 'claude' | 'agents' | 'codex' | 'vscode';
    path: string;            // the file, or the skill directory
    aliases: string[];       // in-repo symlink paths that point at this unit
    name: string;            // skill frontmatter name; rule file stem; otherwise the path
    files: UnitFile[];       // sorted by path
    digest: string;          // 'sha256:<hex>'
    text: string;            // main file decoded as UTF-8 ('' if undecodable)
    frontmatter: Record<string, unknown> | null;
    body: string;            // text without frontmatter
  }
  export interface Finding {
    rule: string; severity: Severity; message: string;
    path?: string; line?: number; column?: number; unitId?: string;
    data?: Record<string, string>;
  }
  ```
- Test helpers:
  - `gitRepo(commits: Array<Record<string, string | Buffer | null>>): Promise<{ dir: string; shas: string[] }>`. A `null` value deletes the file in that commit.
  - `gitSymlink(dir, path, target)` stages a symlink with `git update-index --add --cacheinfo 120000,<blob>,<path>`, so the tests run on Windows without developer mode.
  - `memReader(files: Record<string, string | Buffer>, symlinks?: Record<string, string | null>): RepoReader`, with a `reads` counter for asserting which files were read.

- [x] **Step 1: Write the scaffold.**
  - `package.json`:
    - `"name": "ctxlock"`, `"type": "module"`, `"bin": { "ctxlock": "dist/cli.js" }`, `"files": ["dist"]`, `"private": true`, `"license": "Apache-2.0"`.
    - Scripts: `build` (`tsc -p tsconfig.build.json`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `ci` (`npm run typecheck && npm test && npm run build`).
    - Dependencies: `commander yaml zod ignore picomatch tinyglobby smol-toml`. Dev dependencies: `typescript vitest @types/node @types/picomatch`.
  - `tsconfig.json`: `module`/`moduleResolution` `nodenext`, `strict`, `target es2023`. `tsconfig.build.json` excludes `tests`.
  - `.gitattributes`: `* text=auto eol=lf`.
  - `ci.yml`: a matrix of `[ubuntu-latest, windows-latest]`, Node 22, `npm ci`, `npm run ci`.
- [x] **Step 2: Write the failing tests in `tests/repo/reader.test.ts`:**
  - `fsReader lists tracked and untracked-unignored files, POSIX-sorted, without .git or node_modules`
  - `fsReader includes CLAUDE.local.md even when .gitignore excludes it`. That file changes what Claude Code loads on that machine.
  - `fsReader works in a directory that is not a git repo`
  - `gitReader returns content as of the ref`. Commit 1 has `AGENTS.md` = "a", commit 2 has "b"; `readFile` at commit 1 → "a".
  - `gitReader rejects an unknown ref with RefNotFound`
  - `readFile on a missing path throws FileNotFound`
  - `gitReader listSymlinks maps in-repo targets and returns null for ../../outside`
- [x] **Step 3: Run `npx vitest run tests/repo`.** Expected: FAIL (module not found).
- [x] **Step 4: Implement `src/repo/reader.ts`.**
  - `fsReader` inside a git work tree uses `git ls-files -z --cached --others --exclude-standard`, plus a tinyglobby pass for `**/CLAUDE.local.md`. Outside git it uses tinyglobby (`dot: true`, `followSymbolicLinks: false`, ignoring `**/.git/**` and `**/node_modules/**`).
  - `gitReader` verifies the ref with `git rev-parse --verify <ref>^{commit}`, lists files with `git ls-tree -r -z <ref>` (mode `120000` = symlink), and reads with `git show <ref>:<path>` as a Buffer.
  - Normalize `\` to `/`.
- [x] **Step 5: Run `npm run ci`.** Expected: PASS on the local OS.
- [x] **Step 6: Commit** with `git add -A` and `git commit -m "feat: scaffold ctxlock and add RepoReader for working tree and git refs"`.

### Task 2: Units — frontmatter, digests, discovery

**Files:**
- Create: `src/units/frontmatter.ts`, `src/units/digest.ts`, `src/units/discover.ts`
- Test: `tests/units/frontmatter.test.ts`, `tests/units/discover.test.ts`

**Interfaces:**
- Consumes: `RepoReader`, `Unit`, `Finding` (Task 1).
- Produces:
  ```ts
  export function splitFrontmatter(text: string): { frontmatter: Record<string, unknown> | null; body: string; error: string | null };
  export function sha256Hex(data: Buffer | string): string;
  export function unitDigest(files: UnitFile[]): string;   // 'sha256:' + sha256 of `${path}\0${sha256}\n` lines sorted by path
  export async function discoverUnits(reader: RepoReader): Promise<{ units: Unit[]; problems: Finding[] }>;
  ```

**Discovery patterns** (picomatch with `dot: true`; the first matching row wins):

| Pattern | kind | family | Unit path |
|---|---|---|---|
| `**/AGENTS.md`, `**/AGENTS.override.md` (also at the root) | instructions | agents-md | file |
| `**/CLAUDE.md`, `**/.claude/CLAUDE.md`, `**/CLAUDE.local.md` | instructions | claude | file |
| `.claude/rules/**/*.md` | rule | claude | file |
| `**/.claude/skills/*/SKILL.md` | skill | claude | parent dir |
| `**/.agents/skills/*/SKILL.md` | skill | agents | parent dir |
| `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json` | config | claude | file |
| `.codex/config.toml`, `.codex/hooks.json` | config | codex | file |
| `.vscode/settings.json` | config | vscode | file |

- A skill unit's `files` are every listed file under its directory.
- A symlink whose target resolves to a discovered skill directory adds its link path to that unit's `aliases`.
- [x] **Step 1: Write the failing tests:**
  - `discovers each convention as the right kind and family`. A memReader holds one file per row; the expected `id` list is asserted exactly, e.g. `skill/.agents/skills/release-notes`.
  - `skill digest changes when a script inside the skill changes, and not when a file outside it changes`
  - `unitDigest is independent of input order`
  - `splitFrontmatter gives the same result for LF, CRLF and BOM-prefixed input`
  - `invalid YAML frontmatter becomes an L0-frontmatter problem, must for skills and should for rules, and does not throw`
  - `a non-UTF-8 file becomes an L0-encoding should problem with empty text`
  - `an empty AGENTS.md is a unit with empty text and a digest`
  - `a symlinked skill directory becomes an alias of its target, not a second unit`
  - `a symlink leaving the repo is not followed and becomes an L0-symlink-outside info problem`
  - `discovery reads only candidate files`. A memReader with 20,000 non-context files and 3 context files must have `reads === 3` plus the skill files.
- [x] **Step 2: Run `npx vitest run tests/units`.** Expected: FAIL.
- [x] **Step 3: Implement the three modules.**
  - YAML is parsed with the `yaml` package, core schema, so dates stay strings.
  - The frontmatter must start at byte 0 after an optional BOM and be fenced by `---` lines, accepting CRLF.
- [x] **Step 4: Run `npx vitest run tests/units`.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: discover agent context units with content digests`.

### Task 3: Registry (`ctxlock.yaml`) and CODEOWNERS

**Files:**
- Create: `src/registry/registry.ts`, `src/registry/codeowners.ts`
- Test: `tests/registry/registry.test.ts`, `tests/registry/codeowners.test.ts`

**Interfaces:**
- Consumes: `RepoReader`, `Unit`, `HarnessId`, `Severity`.
- Produces:
  ```ts
  export interface UnitMeta { owner?: string; tier?: 'certified' | 'reviewed' | 'imported' | 'proposal';
    verifiedAt?: string; staleAfter?: string; sources?: string[]; dependsOn?: string[] }
  export interface Registry { present: boolean; harnesses: HarnessId[]; units: Record<string, UnitMeta>;
    limits: Partial<Limits>; lint: { severity: Record<string, Severity | 'off'>; ignore: string[] } }
  export class RegistryError extends Error {}   // message names the YAML path, e.g. "units.AGENTS.md.ownr: unknown key"
  export async function loadRegistry(reader: RepoReader): Promise<Registry>;
  export interface Codeowners { present: boolean; ownersOf(path: string): string[] }
  export async function loadCodeowners(reader: RepoReader): Promise<Codeowners>;
  export function unitOwners(unit: Unit, registry: Registry, codeowners: Codeowners): string[];
  ```
  `Limits` comes from Task 4. Define `src/harness/limits.ts` in this task if Task 4 hasn't run yet.

**Schema** (zod, strict at every level):
- `version: 1` (required).
- `harnesses` defaults to `[claude-code, codex]`.
- `limits`: keys must exist in `LIMITS`; values are non-negative integers. `0` is meaningful: Codex treats `project_doc_max_bytes = 0` as "no docs".
- `units.<unit path>`: `owner`, `tier`, `verified-at`, `stale-after` (both `YYYY-MM-DD`), `sources`, `depends-on`.
- `lint.severity.<rule id>` takes `must|should|info|off`; `lint.ignore` takes globs.

**CODEOWNERS:**
- Looked up at `.github/CODEOWNERS`, then `CODEOWNERS`, then `docs/CODEOWNERS`; the first one found is used.
- Each pattern is tested with its own `ignore()` instance. The last matching line wins, and a line with no owners unassigns.

- [x] **Step 1: Write the failing tests:**
  - `absent ctxlock.yaml gives present false and harnesses [claude-code, codex]`
  - `kebab-case unit fields map to camelCase and 2026-10-01 stays the string '2026-10-01'`
  - `an unknown key throws RegistryError naming units.AGENTS.md.ownr`
  - `an invalid tier throws RegistryError listing certified, reviewed, imported, proposal`
  - `an unknown limits key throws RegistryError`
  - `CODEOWNERS: the last matching pattern wins, a docs/ pattern covers docs/a/b.md, and an owner-less line unassigns`
  - `CODEOWNERS is read from .github/ before root before docs/`
  - `a registry owner overrides CODEOWNERS for that unit, and a skill matches its entry by directory path`
- [x] **Step 2: Run `npx vitest run tests/registry`.** Expected: FAIL.
- [x] **Step 3: Implement both modules.**
- [x] **Step 4: Run `npx vitest run tests/registry`.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: load ctxlock.yaml registry and CODEOWNERS ownership`.

### Task 4: Claude Code resolver

**Files:**
- Create: `src/harness/limits.ts`, `src/harness/types.ts`, `src/harness/imports.ts`, `src/harness/claude-code.ts`
- Test: `tests/harness/claude-code.test.ts`, `tests/harness/imports.test.ts`

**Interfaces:**
- Consumes: `RepoReader`, `Unit`.
- Produces:
  ```ts
  export const LIMITS = {
    codexChainBytes: 32768,           // learn.chatgpt.com/docs/agent-configuration/agents-md (project_doc_max_bytes)
    codexSkillCatalogChars: 8000,     // learn.chatgpt.com/docs/build-skills (fallback when window unknown)
    claudeSkillEntryChars: 1536,      // code.claude.com/docs/en/skills (description + when_to_use)
    claudeLazyFileChars: 40000,       // code.claude.com/docs/en/memory (lazy files, 200K window)
    claudeLaunchFileBytes: 4194304,   // code.claude.com/docs/en/memory (launch files over 4 MiB skipped)
    claudeImportHops: 4,              // code.claude.com/docs/en/memory
    devinCloudFileBytes: 16384,       // docs.devin.ai/onboard-devin/agents-md.md
    skillNameMax: 64, skillDescriptionMax: 1024, skillCompatibilityMax: 500,   // agentskills.io/specification
    skillDescriptionPortable: 1000,   // developers.glean.com/guides/agents/specification.md (lowest common)
    skillBodyLines: 500, skillBodyChars: 20000,   // agentskills.io (~5k tokens at ~4 chars/token)
    alwaysOnInstructionItems: 150,    // IFScale, research/03 §6
  } as const;                         // every value verified 2026-11-05
  export type Limits = { -readonly [K in keyof typeof LIMITS]: number };
  export type LoadMode = 'always' | 'lazy' | 'listed';
  export interface LoadEntry { unitId: string; path: string; mode: LoadMode; reason: string;
    bytes: number; loadedBytes: number; catalogChars?: number }
  export interface EffectiveContext { harness: HarnessId; site: string; entries: LoadEntry[];
    alwaysBytes: number; notes: string[] }
  export interface ResolveInput { reader: RepoReader; units: Unit[]; limits: Limits }
  export function findImports(markdown: string): string[];
  export async function resolveClaudeCode(input: ResolveInput, site: string): Promise<EffectiveContext>;
  ```
  An imported file that is not a unit gets the entry ID `file/<path>`. `alwaysBytes` is the sum of `loadedBytes` over `always` entries.

**Rules.** These are predictions from research/08 §1, checked against real load events in S4.
1. For every directory from `''` down to `site`: `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` load as `always`, reason `ancestor`, shallowest first.
2. **AGENTS.md fallback.**
   - If none of the rule-1 files exist anywhere from `''` to `site`, each ancestor `AGENTS.md` loads as `always`, reason `agents-md-fallback`.
   - Otherwise, each ancestor AGENTS.md that is not imported adds the note `AGENTS.md at <p> not loaded by Claude Code: <claude file> exists`.
3. **Imports.**
   - `@<path>` tokens in `always` files resolve relative to the importing file, up to `claudeImportHops` hops. Only targets that exist in the repo count, and import cycles are safe. They load as `always`, reason `import:<parent>`.
   - A `~/` target adds the note `external import <t> not resolvable in repo`.
4. **Nested CLAUDE.md.** `CLAUDE.md` and `.claude/CLAUDE.md` in directories below `site` load as `lazy`, reason `nested`, with `loadedBytes` capped at `claudeLazyFileChars` characters.
5. **Rules.** Root `.claude/rules/**/*.md` without a `paths` frontmatter key loads as `always`, reason `rule`. With `paths` it loads as `lazy`, reason `paths-glob`.
6. **Skills.**
   - Units under root `.claude/skills/`, by path or by alias, are `listed`. `catalogChars` = name length + min(description + when_to_use length, `claudeSkillEntryChars`).
   - `disable-model-invocation: true` omits the skill and adds a note.
   - Skills under nested `<dir>/.claude/skills/` load as `lazy`, reason `nested-skills`.
7. **`.agents/skills`.** A skill under `.agents/skills/` with no alias under `.claude/skills/` adds the note `skill <name> not visible to Claude Code: .agents/skills is not scanned (anthropics/claude-code#31005)`.
8. **Oversized files.** An `always` file larger than `claudeLaunchFileBytes` is skipped, with a note.

- [x] **Step 1: Write the failing tests:**
  - `ancestor CLAUDE.md files load always, shallowest first`
  - `AGENTS.md loads when no CLAUDE.md exists, and gets the not-loaded note when one does`
  - `@AGENTS.md in CLAUDE.md loads AGENTS.md with reason import:CLAUDE.md`
  - `imports stop after 4 hops`. A chain `CLAUDE.md → a → b → c → d → e` loads a, b, c and d, but not e.
  - `an import cycle terminates and loads each file once`
  - `@types/node, user@example.com, and @x.md inside fences or inline code are not imports`
  - `a nested CLAUDE.md of 50,000 chars is lazy with loadedBytes 40,000`
  - `rules without paths are always; rules with paths are lazy`
  - `a root skill is listed with catalogChars capped at 1536 plus its name length`
  - `a disable-model-invocation skill is omitted with a note`
  - `an .agents/skills skill is invisible unless aliased under .claude/skills`
  - `a 5 MiB CLAUDE.md is skipped with a note`
- [x] **Step 2: Run `npx vitest run tests/harness`.** Expected: FAIL.
- [x] **Step 3: Implement the four modules.**
- [x] **Step 4: Run `npx vitest run tests/harness`.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: predict Claude Code effective context per site`.

### Task 5: Codex resolver, context sites, budget report

**Files:**
- Create: `src/harness/codex.ts`, `src/harness/resolve.ts`, `src/report/budget.ts`
- Test: `tests/harness/codex.test.ts`, `tests/report/budget.test.ts`

**Interfaces:**
- Consumes: Task 4 types, `LIMITS`, and `resolveClaudeCode`.
- Produces:
  ```ts
  export async function resolveCodex(input: ResolveInput, site: string): Promise<EffectiveContext>;
  export function contextSites(units: Unit[]): string[];   // '' plus every directory holding an instructions unit, sorted
  export const RESOLVERS: Record<HarnessId, (input: ResolveInput, site: string) => Promise<EffectiveContext>>;
  export async function resolveAll(input: ResolveInput, harnesses: HarnessId[]): Promise<EffectiveContext[]>;
  export interface BudgetRow { harness: HarnessId; site: string; alwaysBytes: number; limitBytes: number | null;
    catalogChars: number; catalogLimit: number | null; truncated: string[] }
  export function budgetReport(contexts: EffectiveContext[], limits: Limits): BudgetRow[];
  ```

**Codex rules** (research/08 §2):
1. **One file per directory.** For each directory from `''` down to `site`, the first of `AGENTS.override.md` or `AGENTS.md` loads as `always`, reason `chain`.
2. **Combined cap of `codexChainBytes`.** The file that crosses the cap gets `loadedBytes` = the bytes remaining. Every later file gets `loadedBytes: 0`, reason `chain-dropped`.
3. **Nothing below `site` loads.**
4. **Skills.** `.agents/skills/*` in directories from `site` up to `''` are `listed`. `catalogChars` = name + description + path lengths.
5. **Invisible CLAUDE.md.** A site with CLAUDE.md-family files but no AGENTS.md in its chain gets the note `CLAUDE.md content not visible to Codex`.
6. **Invisible `.claude/skills`.** A `.claude/skills` skill with no `.agents/skills` path or alias gets a not-visible note.

**Budget limits:**
- `limitBytes` is `codexChainBytes` for Codex and `null` for Claude Code, which documents no total cap.
- `catalogLimit` is `codexSkillCatalogChars` for Codex and `null` for Claude Code.

- [x] **Step 1: Write the failing tests:**
  - `one file per directory from root to site, and AGENTS.override.md beats AGENTS.md`
  - `files of 20,000 + 20,000 bytes: the second gets loadedBytes 12,768 and any third gets 0 with reason chain-dropped`
  - `an AGENTS.md below the site is not loaded`
  - `skills come from .agents/skills between site and root`
  - `a CLAUDE.md-only repo gets the not-visible-to-Codex note`
  - `a CRLF file's bytes equal its Buffer length`
  - `contextSites returns '' plus every directory with an instructions unit`
  - `budgetReport lists truncated paths per harness and site`
  - `a codexChainBytes override of 65536 removes the truncation`
- [x] **Step 1b: Write conformance tests ported from Codex's own loader tests.**
  - Source: `openai/codex`, `codex-rs/core/src/agents_md_tests.rs`, Apache-2.0.
  - Put them in `tests/harness/codex.conformance.test.ts`.
  - Read each upstream test body and port its fixture and expectation.
  - Record the upstream commit SHA and the Apache-2.0 attribution in the file header.
  - Port at least these:
    - `no_doc_file_returns_none`
    - `doc_smaller_than_limit_is_returned`
    - `doc_larger_than_limit_is_truncated`
    - `total_byte_limit_truncates_later_project_docs`
    - `zero_byte_limit_disables_docs`
    - `finds_doc_in_repo_root`
    - `project_doc_invalid_utf8_uses_lossy_text` (the doc still loads, and its bytes count)
  - These are what validate our Codex predictions, since we cannot run Codex.
- [x] **Step 2: Run `npx vitest run tests/harness/codex.test.ts tests/harness/codex.conformance.test.ts tests/report`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: predict Codex effective context and report budgets`.

### Task 6: Lint framework, L0 skill spec, L1 hidden content

**Files:**
- Create: `src/lint/types.ts`, `src/lint/run.ts`, `src/lint/rules/l0-skill-spec.ts`, `src/lint/rules/l1-hidden.ts`
- Test: `tests/lint/run.test.ts`, `tests/lint/l0.test.ts`, `tests/lint/l1.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export interface LintContext { reader: RepoReader; units: Unit[]; registry: Registry; codeowners: Codeowners;
    contexts: EffectiveContext[]; limits: Limits; today: string /* YYYY-MM-DD */ }
  export interface Rule { id: string; check(ctx: LintContext): Finding[] | Promise<Finding[]> }
  export const RULES: Rule[];                 // later tasks append their rules here
  export async function runLint(ctx: LintContext, extra?: Finding[]): Promise<Finding[]>;
  ```
- `runLint` applies the following, in order:
  - `lint.severity` overrides; `off` drops the finding;
  - `lint.ignore` globs, matched against `finding.path`;
  - de-duplication;
  - sorting by severity (must, should, info), then path, then line.

**Rules:**
- **`L0-skill-spec`** (must). Checks ported from the agentskills.io specification (the skills-ref validator, Apache-2.0):
  - `name` is 1–`skillNameMax` characters, matches `^[a-z0-9]+(-[a-z0-9]+)*$`, and equals the directory's basename;
  - `description` is 1–`skillDescriptionMax` characters;
  - `compatibility` is at most `skillCompatibilityMax` characters.
- **`L1-hidden-unicode`**, over every text file of every unit, including skill scripts:
  - **must:** U+200B–U+200D, U+2060–U+2064, U+FEFF, U+202A–U+202E, U+2066–U+2069, U+E0000–U+E007F, U+FE00–U+FE0F, U+E0100–U+E01EF.
  - **exceptions:** a BOM at offset 0; U+200D between two `\p{Extended_Pictographic}` characters; U+FE0E/U+FE0F right after one.
  - **should:** any other `\p{Cf}`, such as U+200E, U+200F, U+061C or U+00AD.
  - The message gives the code point, its name if known, and the line:column, e.g. `hidden character U+200B ZERO WIDTH SPACE at 14:7`.
- **`L1-html-comment`** (must): `<!-- … -->` outside fenced code blocks in markdown units. The message quotes up to the first 60 characters of the comment.
- [x] **Step 1: Write the failing tests:**
  - L0:
    - `a valid skill passes`
    - `Bad-Name, a--b and a 65-char name fail`
    - `a name differing from the directory fails`
    - `a description of 1024 chars passes and 1025 fails`
    - `a 501-char compatibility fails`
  - L1:
    - `U+200B in a rule is must at the right line and column`
    - `a Tag-block character is must`
    - `U+202E is must`
    - `a BOM at offset 0 is ignored, but a mid-file U+FEFF is must`
    - `👨‍👩‍👧 and ❤️ produce no finding`
    - `CJK text produces no finding`
    - `an RLM in Arabic text is should, not must`
    - `a zero-width character inside a skill script is found`
    - `an HTML comment outside a fence is must, and inside a fence produces nothing`
  - run:
    - `a lint.severity override downgrades a rule, and off drops it`
    - `lint.ignore drops findings under the glob`
    - `findings sort must, should, info, then by path, then by line`
- [x] **Step 2: Run `npx vitest run tests/lint`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS. Then mutation-check: widen the U+200D exception to any position, and watch the ZWJ test fail.
- [x] **Step 5: Commit:** `feat: lint framework with skill-spec and hidden-content rules`.

### Task 7: L2 execution-affecting config and risky instructions

**Files:**
- Create: `src/lint/rules/l2-exec.ts`
- Test: `tests/lint/l2.test.ts`

**Interfaces:**
- Consumes: `Rule`, `config` units.
- Produces `L2-exec-config` findings (severity info). Each carries `data: { file, kind: 'hook' | 'env' | 'mcp' | 'auto-approve', key, fingerprint }`. `fingerprint` is the canonical JSON of the item's value with sorted keys; Task 12 compares fingerprints.

**What gets inventoried:**
- **Claude `.claude/settings*.json`:**
  - each `hooks.<Event>[].hooks[].command`;
  - `env` keys matching `/(_BASE_URL|_API_BASE|_ENDPOINT)$/` or starting with `ANTHROPIC_` or `OPENAI_`;
  - `enableAllProjectMcpServers: true`.
- **`.mcp.json`:** each entry of `mcpServers`.
- **`.codex/config.toml`** (parsed with smol-toml): each `mcp_servers.<name>`, and `hooks`.
- **`.codex/hooks.json`:** its entries.
- **`.vscode/settings.json`:** `chat.tools.autoApprove: true`.

**Other findings:**
- **`L2-risky-instruction`** (should), on markdown and scripts in units. Patterns:
  - `curl` or `wget` piped to `sh`/`bash`/`zsh`;
  - `base64 -d` or `base64 --decode` piped to a shell;
  - `--dangerously-skip-permissions`, `--yolo`, `--trust-all-tools`;
  - `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`;
  - `chat.tools.autoApprove`, `enableAllProjectMcpServers`.
- **`L2-parse`** (should): `could not parse <file>: <reason>`, for invalid JSON or TOML.
- [x] **Step 1: Write the failing tests:**
  - `a SessionStart hook is inventoried with its event and command`
  - `ANTHROPIC_BASE_URL in env is inventoried`
  - `chat.tools.autoApprove true is inventoried and false is not`
  - `codex mcp_servers.github is inventoried`
  - `curl -fsSL https://x.sh | bash in a skill is should`
  - `curl https://x -o out.json is not flagged`
  - `invalid JSON in .claude/settings.json yields L2-parse and no throw`
  - `invalid TOML in .codex/config.toml yields L2-parse and no throw`
  - `the fingerprint ignores key order and changes when a command changes`
- [x] **Step 2: Run `npx vitest run tests/lint/l2.test.ts`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: inventory execution-affecting config and flag risky instructions`.

### Task 8: L3 budgets, L5 instruction count, L6 skill length

**Files:**
- Create: `src/lint/rules/l3-budget.ts`, `src/lint/rules/l5-instructions.ts`, `src/lint/rules/l6-skill-length.ts`
- Test: `tests/lint/l3-l5-l6.test.ts`

**Interfaces:**
- Consumes: `EffectiveContext[]` and `Limits` via `LintContext`.

**`L3-budget`:**

| Severity | Condition | Message |
|---|---|---|
| should | A Codex chain at a site was truncated | `AGENTS.md chain at <site> is <n> bytes; Codex loads the first <codexChainBytes> (<file> cut)` |
| should | A Claude lazy file was capped | — |
| should | A skill's description + when_to_use exceeds `claudeSkillEntryChars`, and claude-code is configured | — |
| should | A site's Codex catalog exceeds `codexSkillCatalogChars` | — |
| info | An agents-md file is larger than `devinCloudFileBytes` | — |
| info | A description is longer than `skillDescriptionPortable` but within `skillDescriptionMax` | — |

**Other rules:**
- **`L5-instruction-count`** (should): for each site and harness, count list-item lines matching `/^\s*(?:[-*+]|\d+[.)])\s+\S/` outside fences, across the text of every `always` entry. Flag when the count exceeds `alwaysOnInstructionItems`.
- **`L6-skill-length`** (should): a SKILL.md body longer than `skillBodyLines` lines or `skillBodyChars` characters.
- [x] **Step 1: Write the failing tests.** These are boundary tests, checked on both sides of each limit:
  - `chain totals of 32768 vs 32769 bytes`
  - `entries of 1536 vs 1537 chars`
  - `descriptions of 1000 vs 1001 chars (info)`
  - `catalogs of 8000 vs 8001 chars`
  - `150 vs 151 list items`
  - `list items inside a fence are not counted`
  - `skill bodies of 500 vs 501 lines and 20000 vs 20001 chars`
  - `a claude-only skill-entry finding is suppressed when ctxlock.yaml lists harnesses [codex]`
- [x] **Step 2: Run `npx vitest run tests/lint/l3-l5-l6.test.ts`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: lint harness budgets, always-on instruction count and skill length`.

### Task 9: L4 discoverable content, L7 duplicates and mirrors, L8 procedure

**Files:**
- Create: `src/lint/rules/l4-discoverable.ts`, `src/lint/rules/l7-duplicates.ts`, `src/lint/rules/l8-procedure.ts`
- Test: `tests/lint/l4-l7-l8.test.ts`

**Rules:**
- **`L4-discoverable`** (should), on instructions units loaded `always` by any harness:
  - 3 or more lines containing `├──`, `└──` or `│ `, inside fences or not;
  - or a heading matching `/^#{1,6}\s+(project|directory|repo(sitory)?|folder|codebase|file)\s+(structure|layout|overview|map|tree)\b/i`.

  Cites research/03 (ETH Zurich: overviews didn't reduce steps).
- **`L7-duplicate-skill`** (should):
  - **(a) Near-duplicates.** Two distinct skill units (aliases don't count) whose description word sets have Jaccard ≥ 0.5. Words are lowercase `[a-z0-9]+` tokens of 3 or more characters, minus a stopword list of about 30 words fixed in the file.
  - **(b) Diverged copies.** The same frontmatter `name` at two paths with different digests: `diverged copies`.
  - Identical copies and symlink aliases produce **no** finding.
- **`L8-procedure`** (info): 5 or more matches in a skill or rule, counting both:
  - `/\b(always|must|never skip)\b[^.\n]{0,40}\b(run|verify|check|test|validate|confirm|re-?run)\b/gi`;
  - `- [ ]` checkbox lines.

  Cites research/03 ("Agent Skills Can Be Harmful": excessive procedure).
- [x] **Step 1: Write the failing tests:**
  - L4:
    - `a fenced directory tree is flagged`
    - `## Project structure is flagged`
    - `## Testing is not`
  - L7:
    - `two descriptions differing by one word are flagged`
    - `unrelated descriptions are not`
    - `the same name with different digests is flagged as diverged`
    - `a symlink alias is not flagged`
    - `an identical copy is not flagged`
  - L8:
    - `5 mandatory-verification phrases give info`
    - `4 give nothing`
- [x] **Step 2: Run `npx vitest run tests/lint/l4-l7-l8.test.ts`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: lint discoverable content, duplicate skills and excessive procedure`.

### Task 10: L9 stale, L10 owner, L11 coverage, L13 AGENTS.md shadowed

**Files:**
- Create: `src/lint/rules/l9-stale.ts`, `src/lint/rules/l10-owner.ts`, `src/lint/rules/l11-coverage.ts`, `src/lint/rules/l13-shadowed.ts`
- Test: `tests/lint/l9-l13.test.ts`

**`L9-stale`** (should):
- **Missing paths.**
  - Applies to inline-code tokens that look like paths: they match `/^(\.{0,2}\/)?[\w.-]+(\/[\w.-]+)+\/?$/`, or end in `.md|.ts|.js|.py|.json|.yaml|.yml|.toml|.sh|.go|.rs`.
  - Skipped when the token contains `* ? { } < > $` or starts with `http`.
  - Flagged when the path resolves neither relative to the unit's directory nor to the repo root.
- **Missing scripts.** `npm run <s>`, `npm test`, `pnpm [run] <s>` or `yarn <s>` where the nearest `package.json` (searching up from the unit's directory) lacks the script. These are skipped: `install`, `i`, `add`, `remove`, `exec`, `dlx`, `create`, `init`, `why`, `up`, `update`, `outdated`, `publish`, `link`, `audit`.
- **Expired.** A registry `stale-after` date earlier than `today`.

**`L9-import-missing`** (info): an `@<path>.md` import whose target is missing.

**`L10-owner`:**
- No registry and no CODEOWNERS: one **info** finding, `No owners: add CODEOWNERS or owners in ctxlock.yaml (<n> units)`.
- Otherwise, each unit with no owner is a **should**.

**`L11-coverage`** (info): only when two or more harnesses are configured. An instructions, rule or skill unit that appears in some harness's contexts but not in another's gets `reaches <harnesses> only`. Units that L13 already reports are excluded.

**`L13-agents-md-shadowed`** (should): only when claude-code is configured. It fires for an AGENTS.md that Codex loads at a site while Claude Code does not, because a CLAUDE.md-family file exists without importing it. Message: `Claude Code ignores <path> because <claude file> exists; add @AGENTS.md to <claude file>`.

- [x] **Step 1: Write the failing tests.** Each is checked in both directions, and every test passes `today` explicitly.
  - L9:
    - `` `src/missing.ts` is flagged and `src/present.ts` is not ``
    - `` `https://x/y.md` and `src/**/*.ts` are not flagged ``
    - `` `npm run build` is flagged when the script is missing, and `pnpm install` never is ``
    - `stale-after 2026-11-04 is flagged with today 2026-11-05, and 2026-11-05 is not`
  - L10: three states:
    - `no CODEOWNERS and no registry → one info`
    - `CODEOWNERS covering all units → nothing`
    - `CODEOWNERS missing one unit → one should`
  - L11:
    - `a rule only in .claude/rules gives info "reaches claude-code only"`
  - L13:
    - `CLAUDE.md without @AGENTS.md plus an AGENTS.md is flagged`
    - `with the import it is not`
    - `with harnesses [codex] it is not`
- [x] **Step 2: Run `npx vitest run tests/lint/l9-l13.test.ts`.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the same command.** Expected: PASS.
- [x] **Step 5: Commit:** `feat: lint stale references, ownership, harness coverage and shadowed AGENTS.md`.

### Task 11: scanRepo, agnix adapter, CLI `scan | lint | budget`

**Files:**
- Create: `src/scan.ts`, `src/lint/agnix.ts`, `src/report/render.ts`, `src/cli.ts`
- Test: `tests/scan.test.ts`, `tests/lint/agnix.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces:
  ```ts
  export interface ScanResult { root: string; ref: string | null; units: Unit[]; registry: Registry;
    contexts: EffectiveContext[]; budget: BudgetRow[]; findings: Finding[] }
  export type AgnixRunner = (root: string) => Promise<string>;   // stdout of `npx --yes agnix --format json <root>`
  export async function agnixFindings(root: string, run?: AgnixRunner): Promise<Finding[]>;
  export async function scanRepo(reader: RepoReader,
    opts?: { agnix?: boolean; runAgnix?: AgnixRunner; today?: string }): Promise<ScanResult>;
  export function renderScan(r: ScanResult, view: 'scan' | 'lint' | 'budget', format: 'text' | 'json'): string;
  export async function main(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void }): Promise<number>;
  ```

**`scanRepo` order:**
1. `discoverUnits`, `loadRegistry` and `loadCodeowners`.
2. Merge limits: `limits = { ...LIMITS, ...registry.limits }`.
3. `resolveAll` over `registry.harnesses`, then `budgetReport`.
4. `runLint(ctx, [...problems, ...agnixFindings])`, where `problems` comes from discovery, and agnix findings are included only with `--agnix`.

`today` defaults to the local date as `YYYY-MM-DD`.

**agnix adapter.** Its JSON was verified on 2026-11-05: `{diagnostics: [{level, rule, file, line, column, message}]}`.
- Mapping: `error` → should, `warning` → info, `info` → info.
- Each finding's rule is `agnix:<rule>`.
- A runner failure or non-JSON output becomes one info finding, `agnix:unavailable`, with the reason.

**Commands:**
- `ctxlock scan|lint|budget [dir] [--format text|json] [--agnix]`
- `dist/cli.js` starts with `#!/usr/bin/env node` and calls `main(process.argv.slice(2), …)`.

**Exit codes:**
- `lint`: 1 if any must finding remains after overrides.
- Any command: 2 for `RegistryError`, `RefNotFound`, or bad arguments, with the message on stderr.

**JSON output:**
- Top level: `version: 1`, `root`, `ref`.
- `units`: `id`, `kind`, `path`, `name`, `digest`, `aliases`.
- Also `contexts`, `budget`, `findings`.
- **Never** unit text.

- [ ] **Step 1: Write the failing tests:**
  - `lint exits 1 on a repo containing U+200B and 0 after it is removed`
  - `lint exits 2 and prints the RegistryError message for an invalid ctxlock.yaml`
  - `--format json never contains unit text` (assert a sentinel sentence from AGENTS.md is absent)
  - `budget prints one row per site and harness`
  - `agnix error maps to should and warning to info, and a failing runner gives agnix:unavailable` (injected runner; no network)
- [ ] **Step 2: Run `npx vitest run tests/scan.test.ts tests/lint/agnix.test.ts tests/cli.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run ci`, then `node dist/cli.js scan .` on this repo.** Expected: PASS, and a scan listing no units, since this repo has no agent context yet.
- [ ] **Step 5: Commit:** `feat: ctxlock scan, lint and budget commands`.

### Task 12: `ctxlock diff` (base vs head) and the PR comment

**Files:**
- Create: `src/diff.ts`, `src/report/markdown.ts`
- Modify: `src/cli.ts` (add `diff`)
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: `scanRepo`, `ScanResult`, `L2-exec-config` fingerprints.
- Produces:
  ```ts
  export interface UnitChange { id: string; change: 'added' | 'removed' | 'modified' }
  export interface DiffResult { base: ScanResult; head: ScanResult; changes: UnitChange[];
    newFindings: Finding[]; resolvedFindings: Finding[];
    budget: Array<BudgetRow & { baseAlwaysBytes: number }>;   // only rows whose alwaysBytes changed
    execChanges: Finding[]; existingMust: number }
  export function diffScans(base: ScanResult, head: ScanResult): DiffResult;
  export function renderDiffMarkdown(d: DiffResult): string;
  ```

**Matching:**
- A finding's key is `rule|unitId-or-path|message`. Line numbers are ignored, because lines shift.
- Each head `L2-exec-config` finding whose `data.fingerprint` is not in base becomes an `execChanges` entry: rule `L2-exec-config-changed`, severity must, message `New or changed: …`.
- Pre-existing must findings only count toward `existingMust`, and never fail a diff.

**CLI:**
- `ctxlock diff --base <ref> [--head <ref>] [dir] [--format text|json|markdown]`; head defaults to the working tree.
- Exit 1 when `newFindings` or `execChanges` contains a must.
- A `RefNotFound` exits 2 with: `base ref <ref> not found — in GitHub Actions use actions/checkout with fetch-depth: 0`.

**Markdown must contain:**
- the heading `### ctxlock · context check`;
- a status line: `❌ <n> must-fix` or `✅ no must-fix issues`;
- a changed-units table;
- a budget table: harness | site | before → after bytes | limit;
- new findings grouped by severity, as `path:line — message`;
- an `Execution-affecting changes` section;
- the resolved count;
- the footer `Static checks only. Behavioral evals come in a later release.`

- [ ] **Step 1: Write the failing tests** (using temp git repos):
  - `adding a rule with U+200B is a new must and exits 1, and diffing the revert exits 0`
  - `a must finding present in both base and head does not fail the diff`
  - `adding a SessionStart hook is an execution-affecting change and exits 1`
  - `changing a hook's command is a change, and reordering JSON keys is not`
  - `budget rows show before and after bytes for changed sites only`
  - `a base sha missing from a depth-1 clone exits 2 with the fetch-depth hint`
  - `markdown contains the status line, changed units, and execution-affecting section`
- [ ] **Step 2: Run `npx vitest run tests/diff.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm run ci`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: ctxlock diff with PR-comment markdown`.

### Task 13: GitHub Action

**Files:**
- Create: `action.yml`, `.github/workflows/self-test.yml`
- Modify: `README.md` (add a Usage section)

**`action.yml`** (composite):
- **Inputs:** `base` (default `${{ github.event.pull_request.base.sha }}`), `fail-on-must` (default `'true'`), `comment` (default `'true'`), `agnix` (default `'false'`).
- **Steps:**
  1. `actions/setup-node` with Node 22. Check the current major tag at build time.
  2. `npm ci` and `npm run build` with `--prefix "$GITHUB_ACTION_PATH"`.
  3. With `set +e`, run `node "$GITHUB_ACTION_PATH/dist/cli.js" diff --base "$BASE" --format markdown > "$RUNNER_TEMP/ctxlock.md"`. Record the exit code as a step output.
  4. Always append the markdown to `$GITHUB_STEP_SUMMARY`.
  5. When `comment == 'true'` and this is a pull request, post with `marocchino/sticky-pull-request-comment@v3`: `header: ctxlock`, `path: $RUNNER_TEMP/ctxlock.md`, `continue-on-error: true`. Fork PRs get a read-only token; the job summary still shows the result.
  6. Fail the job on exit 2, or on exit 1 when `fail-on-must == 'true'`.

**`self-test.yml`:** on `pull_request`, run `actions/checkout` with `fetch-depth: 0`, then `uses: ./`, with `permissions: pull-requests: write`.

**README Usage:** the workflow snippet, covering:
- `fetch-depth: 0`;
- the `permissions` block;
- `uses: SatyamSingh-Git/ctxlock@main`, until a release tag exists;
- what MUST means.

- [ ] **Step 1: Write `action.yml`, `self-test.yml` and the README Usage section.**
- [ ] **Step 2: Verify locally.** Run `node dist/cli.js diff --base HEAD~1 --format markdown` in this repo. Expected: exit 0 and the `✅ no must-fix issues` status line.
- [ ] **Step 3: Ask Satyam** before pushing a test branch and opening a PR. Creating a branch needs his OK (CLAUDE.md).
- [ ] **Step 4: With his OK, open the PR and confirm three things:** the sticky comment appears, the job summary renders, and the check passes. Then push a commit adding a U+200B to a test rule, and confirm the check fails with exit 1.
- [ ] **Step 5: Commit:** `feat: GitHub Action posting the static context check on PRs`.

### Task 14: Dogfood on three public repos

**Files:**
- Create: `docs/dogfood/2026-11-<dd>-static.md`

- [ ] **Step 1: Pick 3 public repos.** Between them they must have, confirmed with `gh api repos/<r>/contents/<path>`:
  - at least one AGENTS.md;
  - at least one CLAUDE.md;
  - at least one skill directory.

  Candidates to check first: `openai/codex`, `vercel-labs/skills`, `anthropics/skills`.
- [ ] **Step 2: Scan each.** Clone each with `--depth 1` and run `node dist/cli.js scan <dir> --format json` and `lint <dir>`. Record every finding in the dogfood report with a verdict: true positive, false positive, or unsure.
- [ ] **Step 3: Fix false positives.** Each MUST false positive gets a rule fix plus a regression test, in the owning rule's test file, before you continue. Re-run until zero MUST false positives remain.
- [ ] **Step 4: Planted-edit check, both directions.** These are the design's Phase 1 exit items (c) and (d). In a temp copy of one repo:
  - (c) append a 300-line directory overview to AGENTS.md. Expect an L4 should, plus budget growth in `diff`.
  - (d) add a U+200B to a rule. Expect a must, and exit 1.

  Reverting each edit must clear its flag.
- [ ] **Step 5: Commit:** `docs: static dogfood report on three public repos`.
- [ ] **Step 6: Run `npm run ci` and report the real result.** Then ask Satyam before pushing.

---

## Part 2: Phase 0 spikes

The spikes are throwaway (code goes in `spikes/`, excluded from the package). The deliverable is a memo in `docs/spikes/`.

**Environment:**
- Claude Code 2.1.292 is installed and logged in on Satyam's Max subscription.
- No Docker, no Codex, no API keys.
- Runs use `claude -p`. Its flags were checked on 2026-11-05: `--output-format`, `--settings`, `--permission-mode`, `--allowedTools` / `--disallowedTools`, `--no-session-persistence`, `--model`, `--add-dir`.

**Quota cap:** at most **150 headless runs** across S1 + S3. Keep probe prompts short. Stop and report if a usage window runs out.

**Ordering:** S1–S3 can start in parallel with Part 1. S4 needs Tasks 4–5.

### Task S1: Eval runner (time box: 3 days)

- [ ] **Step 1: Build a run harness in `spikes/runner/`.**
  - For each run, copy the fixture repo at the arm's ref (base or head) into a temp directory.
  - Write a run-scoped settings file **outside** the copy, and run `claude -p "<prompt>" --output-format stream-json --verbose --settings <file> --no-session-persistence` with the copy as cwd.
  - The settings file sets these hooks:
    - `InstructionsLoaded` → append the payload to a JSONL file;
    - `PostToolUse` with matcher `Skill` → append to the JSONL;
    - **`PreToolUse` with matcher `Bash|Write|Edit` → append the intended command or path, then deny it** ("observe-and-deny"), so nothing executes.
- [ ] **Step 2: Run 2 adherence probes × 2 arms × 3 runs** on a fixture repo.
  - Example: "add lodash as a dependency", with an AGENTS.md that says to use pnpm in the head arm only.
  - Confirm that the denied commands and the loaded files come through in the JSONL, and that nothing ran. The fixture's `node_modules` and lockfile must be unchanged.
- [ ] **Step 3: Record usage per run.** From the final JSON message: `num_turns`, `duration_ms`, and the usage/cost fields it reports. On a subscription the cost figure is notional. Note how much of the usage window the 12 runs took.
- [ ] **Step 4: Try promptfoo as the wrapper.** Wrap the same harness as a promptfoo custom provider (MIT), and compare that with the thin harness on its own.
- [ ] **Step 5: Check the CI auth path.** Verify, from current Anthropic docs, how Claude Code authenticates headless in GitHub Actions on a subscription (for example a token from `claude setup-token`) versus an API key. Do not run anything in CI yet.
- [ ] **Step 6: Write the memo `docs/spikes/S1-eval-runner.md`.** It must cover:
  - the exact commands and the settings file;
  - whether observe-and-deny works reliably, and which tools need it;
  - usage per paired run;
  - flakiness;
  - which substrate to use, scored against the design's criteria;
  - whether transcripts expose the commands, tools and files that probes need;
  - the CI auth answer.

### Task S2: rulesync as the compile backend (time box: 1 day)

- [ ] **Step 1: Import a fixture.** In `spikes/rulesync/`, install rulesync and import a fixture repo with AGENTS.md, `.claude/rules` with `paths`, and `.agents/skills`.
- [ ] **Step 2: Generate.** Generate for Claude Code, Codex, Copilot and Cursor. Check the current target names in rulesync's docs.
- [ ] **Step 3: Diff the output** against the Task 4–5 resolver predictions. Does the result fix L13 shadowing, `.agents/skills` visibility and path-scoped rules for Codex?
- [ ] **Step 4: Check the integration surface.** Does the package export a programmatic API, or only a CLI?
- [ ] **Step 5: Write the memo `docs/spikes/S2-rulesync.md`.** Cover: library vs CLI, what it emits, gaps we must add (the compact index, budget fitting), its update cadence and license.

### Task S3: Reproduce two published effects (time box: 2 days; within the quota cap)

Both need neither Docker nor real builds, and both use the S1 harness.

- [ ] **Step 1: Adherence effect** (ETH Zurich, research/03 §1: a tool named in the context file gets used about 1.6 times per task, vs under 0.01 when not named).
  - Use 5 tasks where a named tool changes the right command, e.g. `uv` vs `pip`, or `pnpm` vs `npm`.
  - Two arms: an AGENTS.md that names the tool, and one that doesn't. 3 runs each.
  - Grade the intended commands that observe-and-deny captured.
- [ ] **Step 2: Index vs skill** (Vercel, research/03 §1: an index in AGENTS.md scored 100%, vs 53% when the docs sat behind a skill).
  - Use 5 questions whose answers exist only in a docs folder in the repo. Check the answers with a regex.
  - Three arms:
    - (i) the docs behind a `.claude/skills/<x>/SKILL.md` that points at them;
    - (ii) a compact pipe-delimited index in CLAUDE.md that points at the same files;
    - (iii) no pointer.
  - 3 runs each. Record the skill-invocation rate and the units loaded.
- [ ] **Step 3: Write the memo `docs/spikes/S3-reproduction.md`.** Cover:
  - whether each *direction* reproduced on current Claude models;
  - rates with spread;
  - usage spent;
  - what that implies for the per-PR default of 24 runs and 20 minutes.

### Task S4: Telemetry join (time box: 2 days; needs Tasks 4–5)

- [ ] **Step 1: Capture Claude Code load events.** Install a local Claude Code hook config in `spikes/telemetry/` that writes these payloads to JSONL:
  - every `InstructionsLoaded` payload (`file_path`, `load_reason`, `trigger_file_path`, `parent_file_path`);
  - `PostToolUse` for the Skill tool.

  Run 3 sessions on a fixture repo with nested CLAUDE.md, a path-scoped rule, an `@AGENTS.md` import and skills.
- [ ] **Step 2: Compare with predictions.** Compare the observed loads with `ctxlock scan --format json`. Record every mismatch, then fix the resolver rule and add a regression test in `tests/harness/`.
- [ ] **Step 3: Write the memo `docs/spikes/S4-telemetry.md`.** Cover:
  - the join keys (path + sha256 → unit ID);
  - what Claude Code exposes;
  - resolver accuracy before and after the fixes;
  - the gaps.

  Codex is covered statically by the conformance tests in Task 5, Step 1b.

---

## After this plan

Write **Plan 2: behavioral Context CI** from the S1–S4 memos. It covers:
- adherence and trigger probes (`evals/probes/`, drafted by an LLM and reviewed once);
- `ctxlock eval --base --head` with arms, repeats, base-arm caching, and the cap of 24 runs and 20 minutes (Claude Code via `claude -p`, isolated per run without Docker);
- collectors for Claude Code and Codex inside the sandbox;
- `ctxlock build` report and `--fill-missing`, with generated files recorded in `.ctxlock/generated.json`;
- the behavioral section of the Action comment;
- the design's Phase 1 exit items (a) and (b).
