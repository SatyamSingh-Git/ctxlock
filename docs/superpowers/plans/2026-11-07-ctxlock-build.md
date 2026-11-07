# ctxlock build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ctxlock build`. It reports each agent's effective context, its budgets, the gaps where a unit reaches one agent and not the other, and drift between files maintained by hand. With `--fill-missing` it writes the missing targets, records them in `.ctxlock/generated.json`, and never writes over a file a person wrote or edited. A new lint rule, `L14-generated`, catches generated files that went stale or were edited, so `lint`, `diff` and the Action report drift with no new command.

**Architecture:**
- `.ctxlock/generated.json` is read during every scan. `L14-generated` compares it with the files, and L11 and L13 treat a generated file and its source as one unit.
- A planner turns the scan into fill actions: a skill copied into the other agent's folder, a one-line `CLAUDE.md` that imports a skipped `AGENTS.md`, or an `AGENTS.md` built from what Claude Code loads in a folder. What it cannot fill stays a gap with a reason.
- Before anything is written, the planned files are scanned on an overlay of the repository. Any file an agent would cut is dropped.
- The writer creates only files that are absent, or that ctxlock generated and nobody edited since, inside the repository.

**Tech Stack:** as in Plans 1 and 2: TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, vitest. **No new runtime dependency.**

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md): §5 (`ctxlock build`), §6 Phase 1, §10 item 8. [Spike S2](../../spikes/S2-rulesync.md) settled what the spec left open, and the rulings below answer it.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `d9cb885` |
| 2 | Done | `94a2af8` |
| 3 | Done | `61434a0` |
| 4 | Done | `1282f08` |
| 5 | Done | `55793ea` |
| 6 | Done | `5df7466` |
| 7 | Done | `b7c3e80` |
| 8 | Done: three public repositories and the S2 fixture ([report](../../dogfood/2026-11-07-build.md)); one bug fixed (D55) | the fix and the docs commits |
| Final review | Done: 1 critical and 6 important findings fixed, plus a line-endings minor re-graded important, each with a test that failed first (D56, D57; [chapter 10](../../../journey/10-build.md#what-broke)) | `f1b05c8` |

**Deferred from the final review** (minor, not fixed):
- `M1` (fixed): on a case-insensitive file system, a skill whose name differs only in case from a hand-written one got part of a copy written into the person's folder. Each action is now written whole or not at all.
- `M2` (fixed): the report never mentioned an invalid `.ctxlock/generated.json` unless `--fill-missing` was given. It now says so, and offers no fill.
- `M4` (fixed): the depth-first import walk could drop an import near the hop limit that Claude Code's breadth-first walk loads. Hops now come from a breadth-first walk; the depth-first one only orders the text.
- `M5` (fixed): `--suggest-index` read its folder from the repository's top level, so `.`, `.\docs`, absolute paths and runs from a subfolder failed; folders were ordered by first file, not sorted. The folder is now taken from the directory `build` runs on, and folders are sorted.
- `M6` (fixed): report wording. "Writes the N fills" counted gaps, not fills. After a fill, Budget showed the old budget. A stale copy read as "does not reach". Refusals had one label for two reasons. Each fill is now counted once, the budget is rescanned after a fill, a stale copy "reaches ... out of date", and the label names both reasons.
- `M7` (fixed): `L7` reported a stale generated copy as diverged copies, on top of `L14`. It now leaves a copy whose files are all generated to `L14`.
- `M8` (fixed): an exception partway through `applyFill` left the files written so far unrecorded. The record is now written in a `finally`.
- `M9` (fixed): a rule with `paths: []` gave neither a gap nor an action. It is now a gap, `Codex cannot scope paths: []`.
- `M11` (fixed): no test for imports that add up past 32,768 bytes. One now assembles three 12,000-byte imports.
- `M12` (found in the fix pass; fixed): the preview drops in one pass, so a planned file cut only because an earlier planned file took its room stays dropped after that file is dropped too. The check now repeats until nothing more is dropped, and only the first cut in each chain counts as a cause.

## Rulings this plan makes

Each also goes into `journey/decisions.md` in Task 8.

- **ctxlock writes the Claude Code and Codex targets itself; rulesync waits for the agents ctxlock does not model.** For these two agents, each target is one of three things: a byte copy of a skill, a one-line `@AGENTS.md`, or an `AGENTS.md` assembled from files Claude Code already loads. S2 found that rulesync gets the last one wrong: it appends path rules to the root `AGENTS.md`, and it inlines the two root files into each other. ctxlock can also check its own output with its own resolvers. rulesync stays the planned backend for Cursor and Copilot, which come with their prediction. *If wrong:* Cursor and Copilot users get nothing from `build` in Phase 1.
- **"Never overwrite" means never write over a file ctxlock did not generate, or one edited since.** A generated file whose source changed, and which still has the digest ctxlock recorded, is regenerated. *If wrong:* nothing a person wrote is touched either way.
- **Drift of generated files is a lint rule, `L14-generated`, not a `ctxlock check` command.** `lint`, `diff` and the Action then report it with nothing new to run. *If wrong:* one alias later.
- **A generated file an agent would cut is not written.** The gap stays, with the reason. Splitting content to fit is not automatic in Phase 1. *If wrong:* people split such files by hand.
- **The index suggestion is printed, never written.** Vercel's result came from a compressed index of the docs, not from any index whatever, so the guide says to measure a suggested index with a probe before committing it.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- `build` writes only with `--fill-missing`, and only inside the repository's top level. Any path that would leave it is refused, as `materialize` refuses in `src/eval/workspace.ts`.
- `build` never writes over a file unless `.ctxlock/generated.json` lists it and its current sha256 equals the recorded one.
- Generated files carry no marker inside them; `.ctxlock/generated.json` is the record (spec §5).
- `.ctxlock/generated.json` paths are POSIX, relative to the repository's top level, and sorted. The file is JSON with two-space indent and a trailing newline.
- `build` reads the working tree with `fsReader(root, { local: false })`: personal, gitignored files never drive what gets committed.
- Copies are byte for byte. CRLF stays CRLF.
- Execution config (`config` units: settings, MCP files) is never copied.
- Text output follows the existing renderers in `src/report/`. No agent or model text is involved in `build`.
- Code style: `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test.

## Review Focus

1. **Running `--fill-missing` twice.** The second run writes nothing and leaves `.ctxlock/generated.json` byte-identical (Task 5).
2. **A skill that already reaches both agents through a symlink alias** (`.claude/skills/x -> ../../.agents/skills/x`). That is no gap, and nothing is copied (Task 3).
3. **An entry in `.ctxlock/generated.json` that points outside the repository** (`../x`, an absolute path). It is invalid, and is never read or written (Tasks 1 and 5).
4. **An import cycle in `CLAUDE.md`** (`a.md` imports `b.md`, which imports `a.md`). Assembly stops, and each file appears once (Task 3).
5. **A `CLAUDE.md` with imports that add up to more than Codex's 32,768 bytes.** No `AGENTS.md` is written, and the gap says why (Task 4).

## Files

| File | Responsibility |
|---|---|
| `src/build/generated.ts` | Read, validate and write `.ctxlock/generated.json`; the status of each generated file |
| `src/lint/rules/l14-generated.ts` | `L14-generated` |
| `src/lint/rules/l11-coverage.ts`, `l13-shadowed.ts` | Treat a generated file and its sources as one unit |
| `src/build/plan.ts` | Gaps and fill actions from a scan |
| `src/repo/overlay.ts` | A reader with planned files added, for the preview |
| `src/build/preview.ts` | Scan the overlay and drop actions whose output would be cut |
| `src/build/apply.ts` | Write the actions, and the new `.ctxlock/generated.json` |
| `src/build/drift.ts` | Pairs of hand-maintained files that serve the same folder for different agents and differ |
| `src/build/index-suggest.ts` | The pipe-delimited docs index |
| `src/report/build.ts` | `renderBuild` in text and JSON |
| `src/cli.ts` | `ctxlock build` |

---

### Task 1: `.ctxlock/generated.json` and `L14-generated`

**Files:**
- Create: `src/build/generated.ts`, `src/lint/rules/l14-generated.ts`, `tests/build/generated.test.ts`
- Modify: `src/scan.ts` (`ScanResult.generated`), `src/lint/types.ts` (`LintContext.generated`), `src/lint/run.ts` (register the rule), `the-guide/rules.md` (a section for L14)

**Interfaces:**
- Produces:
  ```ts
  export const GENERATED_FILE = '.ctxlock/generated.json';
  export interface Source { path: string; sha256: string }
  export interface GeneratedFile { path: string; sha256: string; from: Source[] }
  export interface Generated { files: GeneratedFile[]; error: string | null }
  export async function loadGenerated(reader: RepoReader): Promise<Generated>;
  export function serializeGenerated(files: GeneratedFile[]): string;
  export type GeneratedState = 'ok' | 'missing' | 'edited' | 'source-missing' | 'stale';
  export async function generatedStatus(reader: RepoReader, files: GeneratedFile[]): Promise<Array<{ path: string; state: GeneratedState; source?: string }>>;
  ```
  `ScanResult.generated: Generated`; `LintContext.generated: GeneratedFile[]`. `sha256` values are `sha256Hex` hex, like `UnitFile.sha256`.

- [ ] **Step 1: Write the failing tests** in `tests/build/generated.test.ts`, with `memReader`:
  - `loadGenerated` with no file gives `{ files: [], error: null }`.
  - A valid file round-trips: `serializeGenerated(files)` gives `{"version": 1, "files": [...]}` sorted by `path`, two-space indent, trailing newline. Parsing that output gives the same files.
  - `{ version: 2 }`, a file that is not JSON, and an entry with path `../x`, `/etc/x`, `C:/x` or `a\\b` each give `files: []` and an `error` naming the problem.
  - `generatedStatus` gives each state, checked in this order:
    - `missing`: the output is absent;
    - `edited`: the output's sha256 differs from the recorded one;
    - `source-missing`: a `from` path is absent (the result carries `source`);
    - `stale`: a source's sha256 differs (with `source`);
    - `ok`: otherwise.
  - An entry with `from: []` is never `stale`.
  - `L14-generated`, through `runLint`:
    - one `should` finding for each state but `ok`, with these messages:
      - `<path> is listed in .ctxlock/generated.json but missing; run ctxlock build --fill-missing, or remove the entry`
      - `<path> was edited after ctxlock generated it; edit its source instead, or remove the entry to keep the edit`
      - `<path> was generated from <source>, which no longer exists`
      - `<path> is out of date: <source> changed since it was generated; run ctxlock build --fill-missing`
    - one `should` finding `.ctxlock/generated.json is not valid: <error>` for an invalid file;
    - none when everything is `ok`.
- [ ] **Step 2: Run them** with `npx vitest run tests/build/generated.test.ts`. Expected: FAIL, since the module does not exist.
- [ ] **Step 3: Implement.**
  - Validate with zod, reusing `describeIssue` from `src/registry/registry.ts` for messages.
  - A path is valid when it is non-empty, has no backslash, no `..` segment, and no leading `/` or drive letter.
  - `scanRepo` loads it with `loadGenerated(reader)` and passes `generated.files` into the lint context.
  - The invalid-file finding comes from `scan.generated.error`, so the rule needs the error too. Put `generatedError: string | null` next to `generated` in `LintContext`.
- [ ] **Step 4: Run** `npx vitest run tests/build tests/lint`. Expected: PASS.
- [ ] **Step 5: Mutation check** the path validation, each state's order, and the `from: []` case. **Commit:** `feat: .ctxlock/generated.json and L14-generated`.

### Task 2: L11 and L13 read generated files as their sources

**Files:**
- Modify: `src/lint/rules/l11-coverage.ts`, `src/lint/rules/l13-shadowed.ts`
- Test: `tests/lint/l9-l13.test.ts` (or the file that holds the L11 and L13 tests)

**Interfaces:**
- Consumes: `LintContext.generated` (Task 1).
- Produces: `export function shadowed(contexts: EffectiveContext[], generated: GeneratedFile[] = []): Shadowed[]`. A generated `AGENTS.md` is never reported as shadowed. The planner (Task 3) calls it.

- [ ] **Step 1: Write the failing tests.**
  - **Coverage:** `.agents/skills/r` plus a byte-identical `.claude/skills/r`, with `generated.json` listing the copy as generated from the source. L11 reports neither. Without the `generated.json`, L11 reports both, as today.
  - **Shadowed:** a root `CLAUDE.md` and an `AGENTS.md` listed as generated from it. L13 reports nothing. Without the record, L13 reports `AGENTS.md`, as today.
- [ ] **Step 2: Run** them. Expected: FAIL on the "reports neither" and "reports nothing" assertions.
- [ ] **Step 3: Implement.**
  - **L11:** a unit counts as reaching every harness that reaches it, or that reaches a unit it shares a generated record with. A record links the unit holding its `path` to each unit holding one of its `from` paths. Match paths through `unit.files[].path`, which also covers a skill's files.
  - **L13:** `shadowed` skips entries whose `path` is a generated output.
- [ ] **Step 4: Run** `npx vitest run tests/lint`. Expected: PASS.
- [ ] **Step 5: Mutation check. Commit:** `feat: L11 and L13 count a generated file as its source`.

### Task 3: The fill planner

**Files:**
- Create: `src/build/plan.ts`, `tests/build/plan.test.ts`

**Interfaces:**
- Consumes: `ScanResult` (with `generated`), `RepoReader`, `shadowed` (Task 2), `CLAUDE_FILES` and `at` from `src/harness/claude-code.ts`, `findImports` from `src/harness/imports.ts`, `splitFrontmatter`.
- Produces:
  ```ts
  export type FillKind = 'skill-copy' | 'claude-import' | 'agents-md';
  export interface PlannedFile { path: string; bytes: Buffer; from: Source[] }
  export interface FillAction { kind: FillKind; harness: HarnessId; target: string; files: PlannedFile[] }
  export interface Gap { path: string; harness: HarnessId; fill: string | null; reason: string }
  export interface FillPlan { actions: FillAction[]; gaps: Gap[] }
  export async function planFill(scan: ScanResult, reader: RepoReader): Promise<FillPlan>;
  ```
  `Gap.harness` is the agent that is missing the unit. `fill` is the target an action writes, or `null`.

**The rules.** With fewer than both harnesses configured, the plan is empty. A target is **free** when nothing is listed at it or under it. It is also free when every file there is a generated output whose current sha256 equals its recorded one, so a stale copy is regenerated (ruling 2). An action whose files all equal what is already there is dropped, along with its gap: that target is up to date.

1. **`skill-copy`.** A skill that exactly one harness reaches, at any site, and whose mirror is free.
   - `X/.agents/skills/N` mirrors to `X/.claude/skills/N`, and the reverse.
   - Every file of the unit is copied, byte for byte, to the same relative path under the mirror. Each file's `from` is its own source file.
   - A skill reached through an alias, or by both harnesses, is no gap.
   - When the mirror is taken, the gap's reason is `<mirror> exists`.
2. **`claude-import`.** Each `shadowed(...)` entry whose fix begins `create ` gets a target of `<dir>/CLAUDE.md`, containing `@AGENTS.md\n`, with `from: []`. An entry whose fix begins `add ` stays a gap, with the reason `edit by hand: <fix>`.
3. **`agents-md`.** For each folder `D` that has Claude Code always-on content and no `D/AGENTS.md` or `D/AGENTS.override.md` (unless free):
   - **What counts as content:** `D/CLAUDE.md`, `D/.claude/CLAUDE.md`, or a rule in `D/.claude/rules` without `paths`. `CLAUDE.local.md` never counts.
   - **The target** `D/AGENTS.md` is assembled from parts:
     - the CLAUDE files, in `CLAUDE_FILES` order;
     - the files they import, depth-first in order of appearance, each once, within `limits.claudeImportHops` hops, and in the repository only;
     - the unscoped rules, sorted by path, with frontmatter removed.
   - **Assembly:** each part has its trailing whitespace trimmed, the parts are joined with a blank line, and the file ends with one newline. `from` lists every part.
   - **Skip** a folder whose CLAUDE file, ignoring whitespace, consists only of imports of `AGENTS.md`.
   - **Scoped rules:** a rule in `X/.claude/rules` with `paths` is added the same way to `X/F/AGENTS.md`, but only when every pattern is `F/**` or `F/**/*` and `F` has no glob characters. Rule bodies come after any parts from the folder's CLAUDE files. Any other pattern stays a gap: `Codex cannot scope <pattern>`.
4. **Everything else** is a gap with `fill: null`, wherever a unit reaches one harness:
   - a config unit: `execution config is never copied`;
   - an unscoped rule in a folder with a hand-written `AGENTS.md`: `add it to <D>/AGENTS.md by hand`;
   - anything else: `no fill for <kind> files`.

- [ ] **Step 1: Write the failing tests**, one per rule, each in both directions, on `memReader` repositories scanned with `scanRepo`:
  - **`skill-copy`:**
    - `.agents/skills/release/{SKILL.md,scripts/run.sh}` gives one action targeting `.claude/skills/release`. Both files are copied, the CRLF bytes of `run.sh` are unchanged, and each has its own `from`.
    - With `.claude/skills/release` already present, there is no action, and the gap reason is `.claude/skills/release exists`.
    - With the mirror as a symlink alias (`memReader(files, { '.claude/skills/release': '.agents/skills/release' })`), there is no gap.
  - **`claude-import`:**
    - With `CLAUDE.md`, `AGENTS.md` and `packages/api/AGENTS.md`, the target is `packages/api/CLAUDE.md` with the bytes `@AGENTS.md\n`.
    - With `packages/api/CLAUDE.md` present, there is a gap with `edit by hand: add @AGENTS.md to packages/api/CLAUDE.md`.
  - **`agents-md`:**
    - A root `CLAUDE.md` of `Use pnpm.\n\n@docs/testing.md\n`, `docs/testing.md` of `Run pnpm test.\n`, and `.claude/rules/style.md` with no `paths` gives `AGENTS.md` = `Use pnpm.\n\n@docs/testing.md\n\nRun pnpm test.\n\n<style body>\n`.
    - With `AGENTS.md` present, there is no action.
    - An import cycle (`a.md` to `b.md` to `a.md`) puts each file in once.
    - A `CLAUDE.md` of `@AGENTS.md` gives no action.
    - `.claude/rules/api.md` with `paths: ["src/api/**"]` gives `src/api/AGENTS.md` from its body.
    - `paths: ["**/*.ts"]` gives a gap with `Codex cannot scope **/*.ts`.
  - **Free:** a generated `.claude/skills/release` whose source changed, and whose copy is unedited, gets an action. Edit the copy, and there is no action and a gap.
  - **Up to date:** after writing the action's files into the reader, `planFill` gives no actions and no gaps for that skill.
  - **Config:** `.claude/settings.json` reaching one harness is a gap with `execution config is never copied`.
  - **One harness:** with `harnesses: [claude-code]` in `ctxlock.yaml`, the plan is empty.
- [ ] **Step 2: Run** `npx vitest run tests/build/plan.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `planFill`.** It needs the bytes of every source file through `reader.readFile`, and the reach of each unit from `scan.contexts`, gathered across all sites.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Mutation check** each rule's condition, "free", "up to date", the hop limit and the cycle guard. **Commit:** `feat: plan what ctxlock build --fill-missing writes`.

### Task 4: Preview, and files that would be cut

**Files:**
- Create: `src/repo/overlay.ts`, `src/build/preview.ts`, `tests/build/preview.test.ts`

**Interfaces:**
- Consumes: `FillPlan` (Task 3), `scanRepo`.
- Produces:
  ```ts
  export function overlayReader(base: RepoReader, added: Map<string, Buffer>): RepoReader;
  export async function previewFill(reader: RepoReader, plan: FillPlan, settings: Pick<Registry, 'harnesses' | 'limits' | 'lint'>): Promise<{ plan: FillPlan; after: ScanResult }>;
  ```
  In the overlay, `listFiles` lists the base's files plus the added ones, sorted. `readFile`, `exists` and `readAll` serve the added bytes first. Symlinks come from the base.

- [ ] **Step 1: Write the failing tests.**
  - **Overlay:** it lists and reads the added files, and a file added over an existing one reads as the added bytes.
  - **Cut:** a `CLAUDE.md` of 40,000 bytes gives no `AGENTS.md` action after `previewFill`. The gap's reason begins `would be cut:` and quotes Codex's note. A `CLAUDE.md` of 1,000 bytes keeps its action.
  - **After:** `after.budget` has a `codex` row for `.` whose always bytes equal the generated `AGENTS.md`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Scan the overlay with `scanRepo(overlay, { settings })`. Drop every action with a file that any context entry loads with `loadedBytes < bytes` or `reason === 'chain-dropped'`. Its gap takes the reason `would be cut: <the context note that names the file>`.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Mutation check. Commit:** `feat: preview a fill, and leave out files an agent would cut`.

### Task 5: Writing the fill

**Files:**
- Create: `src/build/apply.ts`, `tests/build/apply.test.ts`

**Interfaces:**
- Consumes: `FillPlan` (Task 4's output), `GeneratedFile`, `serializeGenerated`, `generatedStatus` (Task 1).
- Produces: `export async function applyFill(top: string, plan: FillPlan, previous: GeneratedFile[]): Promise<{ written: string[]; refused: string[] }>`. `top` is the repository's top level. `written` is sorted.

- [ ] **Step 1: Write the failing tests**, in temp folders made with `tests/helpers/repo.ts`:
  - It writes every action file, byte for byte, and writes `.ctxlock/generated.json` with an entry per written file (its `sha256` and `from`).
  - **Idempotence:** planning and applying again writes nothing, and `.ctxlock/generated.json` is byte-identical.
  - **Not written over:** a file created at a target between planning and applying (hand-written, not in `previous`) is left as it is, and its path is in `refused`. The same goes for a generated file edited since.
  - **Outside the repository:** an action file whose path leaves `top` (`../x`) is refused and not written.
  - **Previous entries:** entries for paths this run did not touch are kept; entries for rewritten paths are replaced.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Check each file again just before writing it: it must be absent, or listed in `previous` with its current sha256 equal to the recorded one. Otherwise it is refused.
  - Skip a file whose bytes are already there.
  - Refuse a path that leaves `top`, with the same `resolve` and `relative` check as `write()` in `src/eval/workspace.ts`.
  - Write `.ctxlock/generated.json` only when something changed.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Mutation check. Commit:** `feat: ctxlock build writes only what is missing, and records it`.

### Task 6: Drift and the docs index

**Files:**
- Create: `src/build/drift.ts`, `src/build/index-suggest.ts`, `tests/build/drift.test.ts`, `tests/build/index-suggest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Drift { paths: [string, string]; summary: string }
  export function findDrift(scan: ScanResult): Drift[];
  export async function suggestIndex(reader: RepoReader, dir: string): Promise<{ text: string; bytes: number }>;
  ```

**Drift** is two files written by hand that serve the same folder for different agents and differ. Neither may be a generated output, and neither may be an alias of the other. Two cases:
- **`X/.claude/skills/N` and `X/.agents/skills/N`** whose files differ. Compare them as L7 does: relative paths and sha256. The summary is `the copies differ: <relative paths that differ>`.
- **A folder whose CLAUDE file does not import its `AGENTS.md`,** while both exist. The summary is `<n> lines only in CLAUDE.md, <m> only in AGENTS.md`, counting trimmed, non-empty lines as sets.

**The index.** Before writing it, read the format Vercel published: the post linked in [research/03](../../../research/03-evidence-what-context-works.md) and `vercel/next-evals-oss` (MIT). If Next.js ships a generator for it, match that generator's output and cite its commit in a comment. The expected shape, to be confirmed against the source, is:

```
[<dir> index]|root: ./<dir>|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|<folder>:{<file>,<file>}|...
```

It covers the `.md` and `.mdx` files under `dir`, grouped by folder. Folders are sorted, and files within a folder are sorted.

- [ ] **Step 1: Write the failing tests.**
  - **Drift, skills:** two skill copies that differ in `SKILL.md` give one drift naming `SKILL.md`. Identical copies give none, and so does a pair recorded in `generated.json`.
  - **Drift, instruction files:** a `CLAUDE.md` and `AGENTS.md` that differ, with no import, give the line counts. With `@AGENTS.md` in `CLAUDE.md`, there is none.
  - **Index:** `docs/a.md`, `docs/guide/b.md` and `docs/guide/c.mdx` give exactly the confirmed format. `bytes` equals `Buffer.byteLength(text)`. An empty folder gives a `UsageError`-style error: `no markdown files under <dir>`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Mutation check. Commit:** `feat: drift between hand-written files, and a suggested docs index`.

### Task 7: `ctxlock build`

**Files:**
- Create: `src/report/build.ts`, `tests/report/build.test.ts`, `the-guide/build.md`
- Modify: `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`, `the-guide/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export interface BuildReport {
    budget: BudgetRow[]; after: BudgetRow[] | null; gaps: Gap[]; drift: Drift[];
    generated: Array<{ path: string; state: GeneratedState; source?: string }>;
    written: string[]; refused: string[];
  }
  export function renderBuild(r: BuildReport, format: 'text' | 'json'): string;
  ```
  - **Command:** `ctxlock build [dir] [--fill-missing] [--suggest-index <dir>] [--format text|json]`.
  - **Exit codes:** 0 for a report or a fill; 2 when it cannot run.
  - **The index:** with `--suggest-index`, the command prints only the index, its size in bytes, and the line `Not written. Measure it with a probe before you commit it: see the-guide/build.md.`

- [ ] **Step 1: Write the failing tests.**
  - **Render:** a text report with the sections `Budget`, `Gaps` (each `<path> does not reach <harness>` with `fill: <target>` or `no fill: <reason>`), `Drift`, `Generated` and, after a fill, `Wrote`. JSON is the report itself. Empty sections are left out.
  - **CLI**, on a git repository with `.agents/skills/release`:
    - `build` exits 0, prints the gap with `fill: .claude/skills/release`, and writes nothing;
    - `build --fill-missing` writes the copy and `.ctxlock/generated.json`, and prints `Wrote`;
    - a second `--fill-missing` prints no `Wrote`;
    - `lint` on the result has no `L11-coverage` finding for the skill.
  - **Exit 2:** a path that is no directory exits 2.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The command finds the top level with `gitTopLevel(root) ?? root` and reads with `fsReader(root, { local: false })`.
  - The sequence: `scanRepo`, `planFill`, `previewFill`, `findDrift`, `generatedStatus`, then `applyFill` with `--fill-missing`.
  - Write `the-guide/build.md`: what `build` reports, each fill rule with an example, what is never written, `.ctxlock/generated.json`, L14, and the index with its caveat. Add `build` to `commands.md` and to the guide's index.
- [ ] **Step 4: Run** `npm run ci`. Expected: all pass.
- [ ] **Step 5: Mutation check** the CLI wiring. **Commit:** `feat: ctxlock build`.

### Task 8: Live on real repositories, and the record

**Files:**
- Create: `docs/dogfood/2026-11-07-build.md`, `journey/10-build.md`
- Modify: `README.md`, `journey/README.md`, `journey/decisions.md`, this plan's progress table

- [ ] **Step 1: Run `build` on the three clones in `F:/ctxlock-live/repos`** (`plano`, `skills`, `openai-agents-python`) and on the S2 fixture (`spikes/rulesync/fixture`, copied to a fresh git repository). For each, record:
  - the gaps, and what `--fill-missing` writes;
  - that `ctxlock lint` loses the L11 and L13 findings for the filled units;
  - the budget before and after.
- [ ] **Step 2: Both directions,** on one repository:
  - edit a source, and L14 reports `stale`; `--fill-missing` then regenerates the file;
  - edit a generated file, and L14 reports `edited`; `--fill-missing` then leaves it;
  - delete `.ctxlock/generated.json` and the generated files, and the repository is as it was.

  Reset every clone afterwards. Expected: each result as described. If not, debug with superpowers:systematic-debugging.
- [ ] **Step 3: Write the report** (`docs/dogfood/2026-11-07-build.md`), chapter 10, and the decisions for the five rulings above. Then update the README:
  - the status and the roadmap, ticking `build`;
  - usage, adding `build`;
  - agent support, if anything changed.
- [ ] **Step 4: Run** `npm run ci`, then commit and push. **Commit:** `docs: ctxlock build on real repositories, journey chapter 10`.

## After this plan

- A fresh review of the whole plan's range, then the finishing steps, as in Plan 2.
- Next: Cursor and Copilot prediction, with rulesync as their fill backend (ruling 1), or Phase 2's graph. That is Satyam's choice.
