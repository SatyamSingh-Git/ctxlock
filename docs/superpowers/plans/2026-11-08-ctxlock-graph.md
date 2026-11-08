# ctxlock graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dependency graph inside one repository. Consumers are declared in `ctxlock.yaml`, and `depends-on` edges get used. `ctxlock who-uses <unit>` answers what relies on a unit. `ctxlock impact --base <ref>` gives a change's blast radius: what depends on it, which consumers, and whose approval it needs. The same impact shows in the pull request comment, and `ctxlock eval` runs the probes of everything a change reaches, not only of what it touched.

**Architecture:**
- The graph is built in memory from a scan:
  - **units:** from discovery;
  - **`depends-on` edges:** from `ctxlock.yaml`, unit to unit and consumer to unit;
  - **predicted `loaded` edges:** from the resolvers' effective contexts;
  - **owners:** from the existing `unitOwners`;
  - **`compiled_to` edges:** from `.ctxlock/generated.json`, each source to the files generated from it.
- Queries walk the reverse `depends-on` edges breadth-first.
- `impact` compares two scans the way `diff` does, then walks the head graph from the changed units. For a removed unit, it walks the base graph.

**Tech Stack:** as in Plans 1–3: TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, vitest. **No new runtime dependency.**

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md): §4.1 (registry fields), §4.2 (consumers), §4.4 (the graph), §5 (`graph` / `who-uses` / `impact`), §6 Phase 2 (Graph, Queries).

This is the first of Phase 2's plans. It covers one repository. Three things come in later plans:
- observed `loaded` edges from local collectors, and `ctxlock report`;
- the org context repository with `ctxlock sync` and `ctxlock.lock`, which a multi-repo blast radius needs;
- collectors for Copilot and Cursor.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `fa23a7a` |
| 2 | Done | `c851011` |
| 3 | Done | `a410018` |
| 4 | Done | `824f741` |
| 5 | Done | `d74675d` |
| 6 | Done | `f84be8b` |
| 7 | Done: openai-agents-python, no bug ([report](../../dogfood/2026-11-08-graph.md)) | the docs commit |
| Final review | Done: no critical finding; 2 important ones fixed, plus a minor re-graded important, each with a test that failed first ([chapter 11](../../../journey/11-graph.md#what-broke)) | `aec49dd` |

**Deferred from the final review** (minor, not fixed):
- `M4`: a `units:` key that is a symlink alias reads as "which is no unit", and its `owner` and `depends-on` go unused.
- `M5`: the eval report's wording ("Did the agent see the change?", "No probe … covers the changed units") does not fit probes selected by impact.
- `M6`: with no `ctxlock.yaml` but a CODEOWNERS, `impact` lists owners (and in markdown an Impact heading with only them), while `diff`'s comment hides the section.
- `M7`: a dependent's `on`, the change that reaches it, is never shown.
- `M8`: circular imports between `report/markdown.ts`, `report/graph.ts` and `report/render.ts`; `code()` and `cell()` could move to a leaf module.
- `M9`: the ID-to-path slice is written twice, and `reach` rebuilds the reverse edges on every call.
- `M10`: `configuration.md` says "ctxlock graph uses them", but there is no such command; `consumers.<name>.harnesses` reads as used, but is only recorded.
- `M11`: a `depends-on` ending in a bare word that is not a tier (`x@main`) now makes an existing `ctxlock.yaml` invalid; worth a release note.
- `M12`: the comment shows unit IDs under Changed units, and paths under Impact.

## Rulings this plan makes

Each also goes into `journey/decisions.md` in Task 7.

- **Consumers live in `ctxlock.yaml`, under `consumers:`, not in `agents/<name>.yaml`.**
  - Many code repositories have an `agents/` folder of their own: a Python package, agent source code.
  - `ctxlock.yaml` is already the manifest for tools (§4.1), and a coding team's repository usually has one consumer, or a few (§4.2).
  - *If wrong:* the entries move to files, and a loader can read both.
- **A reference is a unit's path, as `ctxlock.yaml`'s `units:` keys are, or its ID, as probes use.** The spec's `skill/<name>` shorthand is not taken: a name can be several units (a skill and its copy). `@<tier>` is the only suffix. Digest pins wait for `ctxlock.lock`, where §7 puts them. Consumers spell the key `depends-on`, as units do; the spec's sketch says `depends_on`. *If wrong:* one more accepted spelling.
- **The graph is built in memory from a scan, with no SQLite (§4.4) until there are events to store.** A scan is fast, and its results can't go stale. *If wrong:* nothing until the collectors' events need a store.
- **`loaded` edges are predicted from the resolvers, and labelled "predicted".** Observed ones come with the local collectors (§9: "predicted, not observed"). *If wrong:* the label changes when collectors land.
- **`impact` is a command, and a section of `diff`'s pull request comment; it never fails a check.** The spec gates only on MUST lint failures and deterministic eval regressions (§5.2). *If wrong:* a flag to gate on it later.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- Nothing in this plan writes to the repository. `who-uses` and `impact` exit 0, or 2 when they cannot run, like `budget`.
- Unit references are POSIX paths from the repository's top, or unit IDs as ctxlock prints them (`kind/path`). A symlink alias of a unit resolves to that unit.
- Tiers rank `certified` > `reviewed` > `imported` > `proposal`. A unit with no tier is `reviewed`, as §4.1 sets for files already in git.
- Owners come from `unitOwners` (the `ctxlock.yaml` owner, then CODEOWNERS) and from a consumer's `owner`.
- Text output follows the renderers in `src/report/`. JSON is the result object itself, as `renderBuild` does it.
- The Action's exit codes do not change.
- Code style: `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test.

## Review Focus

1. **A `depends-on` cycle** (`a → b → a`, or a unit that names itself): `who-uses` and `impact` stop, and list each unit once (Task 2).
2. **A reference through a symlink alias** (`.claude/skills/x -> ../../.agents/skills/x`) resolves to the one unit (Task 2).
3. **A removed unit:** what depended on it still shows in `impact`, found in the base. `L15` then reports the reference that now names no unit (Tasks 2 and 3).
4. **A repository with no `ctxlock.yaml`:** `who-uses` lists predicted loads only, `impact` lists the changes only, and the pull request comment has no Impact section (Tasks 4 and 5).
5. **`who-uses` on something that is no unit:** exit 2, with the reason on stderr (Task 4).

## Files

| File | Responsibility |
|---|---|
| `src/registry/registry.ts` | `consumers:`, tiers, and `@tier` requirements |
| `src/graph/graph.ts` | `resolveRef`, `buildGraph`, `whoUses`, `impactOf` |
| `src/scan.ts` | `ScanResult.codeowners` |
| `src/diff.ts` | `unitChanges`, shared by `diffScans` and `impactOf`; `DiffResult.impact` |
| `src/lint/rules/l15-graph.ts` | `L15-graph` |
| `src/report/graph.ts` | `renderWhoUses`, `renderImpact` |
| `src/report/markdown.ts`, `src/report/render.ts` | The Impact section in `diff` output |
| `src/eval/eval.ts`, `src/report/eval.ts` | Probes selected by impact, and why each ran |
| `src/cli.ts` | `ctxlock who-uses`, `ctxlock impact` |

---

### Task 1: Consumers and tiers in `ctxlock.yaml`

**Files:**
- Modify: `src/registry/registry.ts`, `tests/registry/registry.test.ts`, `the-guide/configuration.md`

**Interfaces:**
- Produces:
  ```ts
  export type Tier = 'certified' | 'reviewed' | 'imported' | 'proposal';
  export interface Requirement { ref: string; tier?: Tier }
  export interface Consumer {
    name: string;
    owner?: string;
    harnesses: HarnessId[];        // default: the registry's harnesses
    models: string[];              // default []; recorded for the eval plans
    repos: string[];               // default []; recorded for sync
    dependsOn: Requirement[];      // default []
    evals: string[];               // default []; probe files or folders under evals/probes/
    maturity: 'experimental' | 'production' | 'deprecated'; // default 'production'
  }
  ```
  `Registry.consumers: Consumer[]`, sorted by name. `UnitMeta.tier: Tier`. `UnitMeta.dependsOn` becomes `Requirement[]`, parsed the same way; nothing reads it yet.
- YAML shape:
  ```yaml
  consumers:
    payments-api:
      owner: "@payments-team"
      harnesses: [claude-code, codex]
      models: [claude-opus-5-5]
      repos: [acme/payments-api]
      depends-on:
        - .agents/skills/api-conventions@certified
        - .claude/rules/testing.md
      evals: [evals/probes/payments.yaml]
      maturity: production
  ```

- [ ] **Step 1: Write the failing tests** in `tests/registry/registry.test.ts`:
  - The example above loads as one `Consumer`, with `dependsOn` `[{ ref: '.agents/skills/api-conventions', tier: 'certified' }, { ref: '.claude/rules/testing.md' }]`.
  - A consumer with only `depends-on` gets the defaults: the registry's harnesses, `[]` for `models`, `repos` and `evals`, and `maturity: 'production'`.
  - Consumers come back sorted by name.
  - Each of these is a `RegistryError` naming the key:
    - `x@latest`: `consumers.payments-api.depends-on.0: "latest" is not a tier (certified, reviewed, imported, proposal)`;
    - an unknown key: `consumers.payments-api.foo: unknown key`;
    - `harnesses: [cursor]`;
    - `maturity: retired`.
  - In `units:`, `depends-on: [a.md@proposal]` parses to `[{ ref: 'a.md', tier: 'proposal' }]`.
- [ ] **Step 2: Run** `npx vitest run tests/registry/registry.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `src/registry/registry.ts`. Split a requirement at its last `@` only when the suffix follows a path, so `@` inside a path stays part of it.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npx tsc --noEmit`.
- [ ] **Step 5: Document** `consumers:` in `the-guide/configuration.md`, in the table and the example, and say which fields are recorded for later plans.
- [ ] **Step 6: Commit** `feat: consumers and tier requirements in ctxlock.yaml`.

### Task 2: The graph

**Files:**
- Create: `src/graph/graph.ts`, `tests/graph/graph.test.ts`
- Modify: `src/scan.ts` (`ScanResult.codeowners: Codeowners`, which `scanRepo` already loads), `src/diff.ts` (extract `unitChanges`)

**Interfaces:**
- Consumes: `Registry.consumers`, `Requirement`, `Tier` (Task 1); `unitOwners` (`src/registry/codeowners.ts`).
- Produces:
  ```ts
  export function unitChanges(base: ScanResult, head: ScanResult): UnitChange[]; // in src/diff.ts, used by diffScans
  export type GraphInput = Pick<ScanResult, 'units' | 'registry' | 'contexts' | 'codeowners'> & { generated: GeneratedFile[] };
  export function resolveRef(ref: string, units: Unit[]): Unit | undefined;      // path, alias or id
  export interface Graph {
    units: Map<string, Unit>;                                        // by id
    dependsOn: Map<string, Array<{ id: string; tier?: Tier }>>;      // unit id -> what it depends on
    consumers: Array<Consumer & { uses: Array<{ id: string; tier?: Tier }> }>;
    loads: Map<string, Array<{ harness: HarnessId; site: string; mode: LoadMode }>>; // predicted
    compiledTo: Map<string, string[]>;                               // unit id -> paths generated from its files
    dangling: Array<{ from: string; ref: string }>;                  // from: 'ctxlock.yaml', a unit path, or `consumer <name>`
    owners(id: string): string[];
    tier(id: string): Tier;
  }
  export function buildGraph(input: GraphInput): Graph;
  export interface Use { id: string; via: string[] }                 // via: unit ids from the dependent down to the unit asked about, excluding both
  export interface ConsumerUse { name: string; owner?: string; maturity: Consumer['maturity']; via: string[] }
  export interface WhoUses { id: string; units: Use[]; consumers: ConsumerUse[]; loads: Array<{ harness: HarnessId; site: string; mode: LoadMode }>; generated: string[] }
  export function whoUses(graph: Graph, id: string): WhoUses;
  export interface Impact { changed: UnitChange[]; dependents: Use[]; consumers: ConsumerUse[]; owners: string[] }
  export function impactOf(base: ScanResult, head: ScanResult): Impact;
  ```
  - `dangling` lists three kinds of reference that name no unit:
    - a `units:` key in `ctxlock.yaml`;
    - a unit's `depends-on` entry;
    - a consumer's `depends-on` entry.
  - `impactOf` has these rules:
    - **`dependents`:** units that depend on a changed unit, directly or not, that did not change themselves. They are found in the head graph, or in the base graph for a removed unit.
    - **`owners`:** sorted and unique. They are the owners of each changed unit, plus the owners of each consumer reached.
    - **Ordering:** lists are sorted by id or name.
    - **Ties:** each unit's `via` is its shortest chain.

- [ ] **Step 1: Write the failing tests** in `tests/graph/graph.test.ts`, with `memReader` and `scanRepo`:
  - **`resolveRef`:** finds a unit by its path, by its ID, and by a symlink alias (Review Focus 2). It gives `undefined` for a path that is no unit.
  - **`buildGraph`:**
    - a rule that `depends-on` a skill gets that edge;
    - a consumer's `uses` resolves its requirements;
    - `loads` holds each harness and site that loads the skill, with its mode;
    - `compiledTo` maps a skill to the copy `.ctxlock/generated.json` records for it;
    - the three kinds of dangling reference each appear once, with their `from`.
  - **`whoUses`:**
    - `c` depends on `b`, `b` on `a`, and a consumer on `c`. Asked about `a`, it gives `b` (via `[]`), `c` (via `[b]`), and the consumer (via `[c, b]`).
    - A cycle (`a → b → a`), and a unit that names itself, list each unit once and terminate (Review Focus 1).
  - **`impactOf`:**
    - Modifying `a` reaches `b`, `c` and the consumer. The owners are the CODEOWNERS owner of `a` plus the consumer's `owner`.
    - Removing `a` still reaches `b` and `c`, found in the base (Review Focus 3).
    - With no `ctxlock.yaml`, only `changed` is non-empty.
    - A dependent that changed too appears under `changed`, not under `dependents`.
- [ ] **Step 2: Run** `npx vitest run tests/graph/graph.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/graph/graph.ts`; move the change computation out of `diffScans` into `unitChanges`, and add `codeowners` to `ScanResult`.
- [ ] **Step 4: Run** the graph tests and `npx vitest run tests/diff.test.ts tests/scan.test.ts`. Expected: PASS. Then `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: the dependency graph: depends-on, consumers, predicted loads`.

### Task 3: `L15-graph`

**Files:**
- Create: `src/lint/rules/l15-graph.ts`
- Modify: `src/lint/run.ts` (register after `generatedDrift`), `tests/lint/l15-graph.test.ts` (create), `the-guide/rules.md`

**Interfaces:**
- Consumes: `buildGraph` (Task 2), with the `LintContext` fields it needs.
- Produces: rule `L15-graph`, severity `should`, path `ctxlock.yaml`, with these messages:
  - `ctxlock.yaml lists <ref>, which is no unit`
  - `<from> depends on <ref>, which is no unit`
  - `consumer <name> needs <ref> at <tier>; it is <tier>`
  - `consumer <name> lists evals <path>, which holds no probe file`

- [ ] **Step 1: Write the failing tests** in `tests/lint/l15-graph.test.ts`, with `lintContext`. Each case has a clean counterpart that gives no finding:
  - Each message above, once each, with its exact text.
  - A requirement that is met: `@reviewed` against a unit with no tier, and `@imported` against a `certified` one.
  - An `evals` path that holds a probe file.
  - A removed unit's leftover reference (Review Focus 3).
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** the rule.
- [ ] **Step 4: Run** `npx vitest run tests/lint`. Expected: PASS.
- [ ] **Step 5: Document** `L15-graph` in `the-guide/rules.md`, with each message and its fix.
- [ ] **Step 6: Commit** `feat: L15-graph: references to no unit, and unmet tier requirements`.

### Task 4: `ctxlock who-uses` and `ctxlock impact`

**Files:**
- Create: `src/report/graph.ts`, `tests/report/graph.test.ts`
- Modify: `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`

**Interfaces:**
- Consumes: `buildGraph`, `whoUses`, `impactOf`, `resolveRef` (Task 2).
- Produces:
  ```ts
  export function renderWhoUses(w: WhoUses, format: 'text' | 'json'): string;
  export function renderImpact(i: Impact, format: 'text' | 'json' | 'markdown'): string;
  ```
  - `ctxlock who-uses <unit> [dir] [--format text|json]` reads the working tree with `fsReader(root)`. A `<unit>` that resolves to no unit exits 2: `no unit at <unit>` (Review Focus 5).
  - `ctxlock impact [dir] --base <ref> [--head <ref>] [--format text|json|markdown]`. Its refs are read as `diff` reads them, with the same errors.
  - Text layout. Empty sections are left out, as in `renderBuild`:
    ```
    ctxlock who-uses · .agents/skills/release

    Units that depend on it:
      .claude/rules/deploy.md
      .claude/rules/ship.md     through .claude/rules/deploy.md

    Consumers:
      payments-api  @payments-team  production  through .claude/rules/deploy.md

    Loaded by (predicted):
      claude-code  .  listed

    Generated from it:
      .claude/skills/release/SKILL.md
    ```
    Units show as their paths. `via` shows as `through <path>, <path>`. `impact` has the sections `Changed`, `Depends on what changed`, `Consumers` and `Owners to ask`. Its markdown follows `renderDiffMarkdown`'s style, with each path in `code()`.

- [ ] **Step 1: Write the failing tests:**
  - **Renderer tests:** each section, empty sections left out, `through` chains, and JSON equal to the input.
  - **CLI tests:**
    - `who-uses` on a path, an ID and an alias gives the same answer;
    - an unknown unit exits 2 with `no unit at x` on stderr;
    - `impact --base` on a `gitRepo` with two commits lists the dependents and owners;
    - with no `ctxlock.yaml`, the output is `Changed` only (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run tests/report/graph.test.ts tests/cli.test.ts -t "who-uses|impact"`. Expected: FAIL.
- [ ] **Step 3: Implement** the renderers and the two commands.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Document** both commands in `the-guide/commands.md`, with their exit codes.
- [ ] **Step 6: Commit** `feat: ctxlock who-uses and ctxlock impact`.

### Task 5: Impact in `diff` and the pull request comment

**Files:**
- Modify: `src/diff.ts` (`DiffResult.impact: Impact`), `src/report/markdown.ts`, `src/report/render.ts` (the text diff), `tests/diff.test.ts` (where both diff renderers are tested), `the-guide/github-action.md`

**Interfaces:**
- Consumes: `impactOf` (Task 2); `renderImpact`'s section bodies (Task 4).
- Produces: `diffScans` sets `impact`. The Impact section is placed:
  - in markdown: `#### Impact`, after `#### Changed units`;
  - in text: after the changed units.

  It is shown only when `dependents` or `consumers` is non-empty, and it does not change the exit code.

- [ ] **Step 1: Write the failing tests:**
  - A diff where a changed rule has a dependent and a consumer shows `#### Impact`, with them and `Owners to ask`, and its exit code is unchanged.
  - A diff in a repository with no `ctxlock.yaml` has no `Impact` heading (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run tests/diff.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, and `npx vitest run tests/action.test.ts`. Expected: PASS.
- [ ] **Step 5: Document** the section in `the-guide/github-action.md`.
- [ ] **Step 6: Commit** `feat: diff and the pull request comment show a change's impact`.

### Task 6: Probes selected by impact

**Files:**
- Modify: `src/eval/eval.ts`, `src/report/eval.ts`, `tests/eval/eval.test.ts`, `tests/report/eval.test.ts`, `the-guide/evals.md`

**Interfaces:**
- Consumes: `impactOf` (Task 2); `Consumer.evals` (Task 1).
- Produces: `ProbeOutcome.selectedFor: string`, which is one of:
  - `'changed'`: its unit changed;
  - `` `depends on <path>` ``: its unit depends on a changed unit, directly or not;
  - `` `consumer <name>` ``: its file is under the `evals` of a consumer the change reaches.

  `--all` sets `'all'`. The eval report shows `selectedFor` for every probe not selected as `'changed'`.

- [ ] **Step 1: Write the failing tests:**
  - A rule changes and a skill depends on it. The skill's trigger probe runs, with `selectedFor: 'depends on .claude/rules/x.md'`.
  - A consumer's `evals` file holds a probe for an unchanged unit, and the consumer depends on the changed rule. That probe runs, with `selectedFor: 'consumer payments-api'`.
  - A probe of a unit nothing connects to the change does not run.
  - Use the fake Claude Code the existing eval tests use.
- [ ] **Step 2: Run** the eval tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the run budget and its ordering. Probes selected as `'changed'` keep their places first.
- [ ] **Step 4: Run** `npx vitest run tests/eval tests/report`. Expected: PASS.
- [ ] **Step 5: Document** the selection in `the-guide/evals.md`.
- [ ] **Step 6: Commit** `feat: eval runs the probes of everything a change reaches`.

### Task 7: Dogfood, docs and decisions

**Files:**
- Create: `the-guide/graph.md`, `docs/dogfood/2026-11-08-graph.md`, `journey/11-graph.md`
- Modify: `the-guide/README.md`, `README.md` (roadmap and command list), `journey/README.md`, `journey/decisions.md` (D58–D62 from the rulings above), this plan's progress table

- [ ] **Step 1: Run it on a real repository.**
  - Pick one of the dogfood clones under `F:/ctxlock-live*`.
  - On a throwaway branch of the clone (outside this repository), add a `ctxlock.yaml` with a consumer and two `depends-on` edges, then commit.
  - Edit a depended-on unit, and run `who-uses`, `impact --base HEAD~1`, `diff --format markdown`, and `lint`.
  - Copy the real output into `docs/dogfood/2026-11-08-graph.md`.
  - Any bug found gets a failing test first.
- [ ] **Step 2: Write** these docs:
  - `the-guide/graph.md`: consumers, references, tiers, `who-uses`, `impact`, and the "predicted" label;
  - `journey/11-graph.md`, in the existing chapters' form;
  - the decisions, the README and the progress table.
- [ ] **Step 3: Run** `npm run ci`. Expected: exit 0. Report the real result.
- [ ] **Step 4: Commit** `docs: the graph, on a real repository; journey chapter 11, decisions D58–D62`.

## After this plan

- A fresh review of the whole plan's range, then the finishing steps, as in Plans 2 and 3.
- Next in Phase 2: local collectors and observed `loaded` edges (a Claude Code plugin writing `context.load` events), then the org context repository with `ctxlock sync` and `ctxlock.lock`.
