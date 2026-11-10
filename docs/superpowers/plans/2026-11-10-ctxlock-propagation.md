# ctxlock propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shared context live in an org context repository, and let each repository that uses it take changes the way it takes dependency updates: as a reviewed pull request.
- **`ctxlock sync`** brings declared skills and rules in from an upstream repository at a ref. It writes them, and pins the commit and every file's digest in **`ctxlock.lock`**.
- **`L16-lock`** catches a synced file edited by hand, or a lock that no longer matches.
- **`ctxlock impact --locks`** names, across repositories, those whose lock pins a unit a change touches.
- **`ctxlock report`** exports `loads`'s counts for the org repository to collect.

**Architecture:**
- **The consumer pulls.** `sync` runs in a consumer repository, locally or in that repository's own scheduled workflow. It fetches the upstream into ctxlock's cache with `git`, reads it at the resolved commit through the existing `gitReader`, and writes only into the consumer repository.
- **The update arrives as a pull request.** A workflow template commits the result to a branch, and opens the pull request with the repository's own `GITHUB_TOKEN`. That pull request then runs ctxlock's existing Action: lint, diff with its Impact section, and impact-selected probes.
- **`ctxlock.lock` borrows APM's shape** ([lockfile spec](https://microsoft.github.io/apm/reference/lockfile-spec/)): an upstream's repository, ref and resolved commit, then per unit its digest and every file's SHA-256, with CRLF read as LF, as D54 and APM both do.

**Tech Stack:** as in Plans 1–5: TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, vitest; `git` on the `PATH`. **No new runtime dependency.**

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- §1, the north star;
- §5, the `sync` row: "Org context repo → PRs into consumer repos, with lockfile and evals"; APM's lock design;
- §6 Phase 2: Propagation, the blast radius from declared sources and `ctxlock.lock`, `ctxlock report`, and the exit criterion "a multi-repo demo where one upstream edit produces the correct blast radius";
- §7 Phase 2: digest pinning with any change re-approved; `sync` never distributes hooks or MCP registrations.

Satyam asked on 2026-11-10 to start the work without further design questions. Every call below that the spec leaves open is marked as mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Not started | |
| 2 | Not started | |
| 3 | Not started | |
| 4 | Not started | |
| 5 | Not started | |
| 6 | Not started | |
| 7 | Not started | |

## Rulings this plan makes (my calls)

Each also goes into `journey/decisions.md` in Task 7.

- **D68. The consumer pulls; nothing pushes.**
  - `ctxlock sync` changes only the repository it runs in. The update pull request is opened by that repository's own workflow, with its own `GITHUB_TOKEN`.
  - This is Dependabot's model. A bot in the org repository opening pull requests everywhere would need one credential with write access to every consumer repository. That is the largest credential a context tool could hold, and §7 asks for the opposite.
  - *If wrong:* a push mode can later run the same `sync` in each repository.
- **D69. A consumer declares what it takes, under `upstream:` in `ctxlock.yaml`.** For each upstream it gives a name, a `repo` (any git URL, or a local path), a `ref` to follow, and the `units` it takes, as paths in the upstream.
  - A unit lands at the same path in the consumer.
  - `sync` never writes over a file that `ctxlock.lock` doesn't list. That would be a person's file, so it refuses, as D50 does.
  - *If wrong:* a `to:` path per unit.
- **D70. `ctxlock.lock` is YAML in APM's shape, committed.**
  - `lockfile_version: 1`, then `upstreams[]`, each with `name`, `repo`, `ref`, `commit` (40 hex) and `units[]`.
  - Each unit has `path`, `id`, `digest` (ctxlock's unit digest), `tier` (as the upstream's `ctxlock.yaml` gives it), and `files`, a map of path to LF SHA-256.
  - `sync` follows the ref and rewrites the lock only when its content changes. Every change to the lock therefore arrives through a diff someone reviews: that is §7's re-approval.
  - *If wrong:* a `--frozen` replay, as APM has.
- **D71. Only skills and rules sync.**
  - Instructions files (`AGENTS.md`, `CLAUDE.md`) are a repository's own. Merging a shared one into them is a separate problem.
  - Config units are never synced: settings, hooks and MCP registrations (§7).
  - A unit of any other kind in `units:` is a usage error, exit 2.
  - *If wrong:* instruction fragments imported through `@` lines, later.
- **D72. A synced unit's tier is the upstream's.**
  - `L15`'s tier checks, and the graph, read a synced unit's tier from `ctxlock.lock`.
  - A consumer's own `units:` entry can't raise it: the tier belongs to whoever owns the unit.
  - *If wrong:* a consumer-side override.
- **D73. Multi-repository blast radius comes from lockfiles, read from local copies.**
  - `ctxlock impact --locks <path>…` reads each `ctxlock.lock` found under those paths, and lists the repositories that pin a unit the change touches.
  - Fetching locks over GitHub's API waits for the org tier, as D67 left it.
  - *If wrong:* a fetcher later.
- **D74. `ctxlock report` writes `loads`'s JSON for sharing, with nothing local in it.**
  - It names the repository by its `origin` URL.
  - It drops the error message, which can carry a local path (Plan 5's ruling), and keeps only the count of errors.
  - Reading reports on the org side waits for a later plan.
  - *If wrong:* more fields, by request.
- **D75. The live demo uses local repositories.**
  - It uses an org repository and two consumers on disk, with `repo:` as a path. The spec's multi-repo exit criterion needs no GitHub.
  - A demo on GitHub needs Satyam's OK for each repository and pull request.
  - *If wrong:* none; the same commands work on URLs.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency. `git` is called with `execFile`, never through a shell.
- **`sync` writes only:**
  - the files of declared units, at their paths;
  - `ctxlock.lock`;
  - and through `build`'s existing fill, the agent copies of what it wrote.

  It never writes over a file the lock doesn't list, and never deletes a file the lock doesn't list.
- **Upstream content is data.** Nothing in it executes during `sync`: no hooks, no scripts, no `git` hooks. Clones use `--no-checkout`, and files are read through `gitReader`.
- **Every digest uses the same functions:** `unitDigest` and `lfDigest`.
- **Exit codes:**
  - **0:** done.
  - **1:** for `lint`, a `must` finding (`L16` is a `must` for an edited synced file); for `sync`, a refusal, so a workflow stops rather than open an empty pull request.
  - **2:** it cannot run. The reason goes on stderr.
- **Markdown output** puts repository text in `code()` spans, as the pull request comment does.
- **Code style:** `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test.

## Review Focus

1. **The upstream moves a unit, or deletes it:** `sync` removes the files it wrote for it, and only those, and the lock entry goes (Task 3).
2. **A synced file edited by hand:** `sync` refuses to write over it and says which file, and `L16` reports it (Tasks 3 and 4).
3. **A ref that doesn't exist, an unreachable repository, or a declared unit the upstream lacks:** exit 2, naming the upstream and the path, and nothing written (Tasks 2 and 3).
4. **CRLF checkouts on either side:** a file whose only difference is line endings is not a change (Tasks 1 and 3).
5. **An upstream skill that carries a `settings.json` or `hooks/` folder:** those files are not written, and `sync` says so (Task 3).

## Files

| File | Responsibility |
|---|---|
| `src/registry/registry.ts` | `upstream:` in `ctxlock.yaml` |
| `src/sync/lock.ts` | `ctxlock.lock`: types, `loadLock`, `serializeLock` |
| `src/sync/fetch.ts` | `fetchUpstream`: clone or fetch into the cache, resolve a ref, return a reader at the commit |
| `src/sync/sync.ts` | `planSync`, `applySync` |
| `src/lint/rules/l16-lock.ts` | `L16-lock` |
| `src/graph/graph.ts` | tiers from the lock; `pinnedBy` for `--locks` |
| `src/report/sync.ts` | `renderSync` (text, json, markdown) |
| `src/collect/report.ts` | `buildReport` |
| `src/cli.ts` | `ctxlock sync`, `ctxlock report`, `impact --locks` |
| `templates/ctxlock-sync.yml` | The workflow that opens the update pull request |

---

### Task 1: `upstream:` in `ctxlock.yaml`, and `ctxlock.lock`

**Files:** Modify `src/registry/registry.ts`, `tests/registry/registry.test.ts`. Create `src/sync/lock.ts`, `tests/sync/lock.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // registry.ts
  export interface Upstream { name: string; repo: string; ref: string; units: string[] }
  Registry.upstreams: Upstream[]          // sorted by name; units through repoPath
  // lock.ts
  export const LOCK_FILE = 'ctxlock.lock';
  export interface LockedUnit { path: string; id: string; digest: string; tier: Tier; files: Record<string, string> }
  export interface LockedUpstream { name: string; repo: string; ref: string; commit: string; units: LockedUnit[] }
  export interface Lock { upstreams: LockedUpstream[] }
  export async function loadLock(reader: RepoReader): Promise<Lock>   // absent file → { upstreams: [] }
  export function serializeLock(lock: Lock): string                   // stable: upstreams by name, units by path, files by path
  export class LockError extends Error {}
  ```
- `upstream:` is a map of name to `{ repo, ref?, units }`, with `ref` defaulting to `main`. Unknown keys are errors, as everywhere in `ctxlock.yaml`. `loadLock` validates with zod: `lockfile_version` must be `1`, and `commit` must be 40 hex characters. Any other content is a `LockError` naming the file.

- [ ] **Step 1: Write the failing tests:**
  - `reads upstreams, sorted by name, with ref defaulting to main and unit paths as people type them`;
  - `names the key of an unknown upstream field`;
  - `serializeLock is stable whatever the order it is given, and loadLock reads it back`;
  - `an absent lock is empty; a lock with another version or a short commit is a LockError`.
- [ ] **Step 2: Run** `npx vitest run tests/registry tests/sync/lock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. **Commit** `feat: upstream in ctxlock.yaml, and ctxlock.lock`.

### Task 2: Fetching an upstream

**Files:** Create `src/sync/fetch.ts`, `tests/sync/fetch.test.ts`.

**Interfaces:**
- Consumes: `Upstream` (Task 1), `gitReader`.
- Produces:
  ```ts
  export class UpstreamError extends Error {}
  export async function fetchUpstream(u: Upstream, cache: string): Promise<{ commit: string; reader: RepoReader }>;
  ```
- **Fetching:**
  - **The cache folder:** `<cache>/upstream/<sha256(repo) first 16 hex>`.
  - **The first time:** `git clone --no-checkout --quiet <repo> <dir>`.
  - **Later:** `git -C <dir> fetch --quiet --prune origin`.
  - **Resolving the ref:** `git rev-parse --verify <ref>^{commit}`, tried as `origin/<ref>` first and then as `<ref>`, so tags and commit SHAs work too.
- **Failure:** every `git` failure becomes an `UpstreamError` naming the upstream and the ref.
- **Hooks:** `core.hooksPath` is set to an empty folder for each call, so no hook in the upstream or in global git config runs.

- [ ] **Step 1: Write the failing tests.** They run on real local repositories made with `gitRepo`, given as `repo:` paths.
  - `fetches an upstream into the cache and resolves a branch, a tag and a commit`;
  - `a second fetch sees a commit pushed since`;
  - `a ref that doesn't exist, and a repository that doesn't, are UpstreamErrors naming the upstream` (Review Focus 3);
  - `the reader gives the files at the resolved commit, not the working tree`.
- [ ] **Step 2: Run** `npx vitest run tests/sync/fetch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: fetch an upstream into ctxlock's cache at a ref`.

### Task 3: `ctxlock sync`

**Files:** Create `src/sync/sync.ts`, `src/report/sync.ts`, `tests/sync/sync.test.ts`, `tests/report/sync.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`.

**Interfaces:**
- Consumes: Tasks 1 and 2; `scanRepo`, `unitDigest`, `lfDigest`, `planFill` and `applyFill`.
- Produces:
  ```ts
  export type SyncChange = { upstream: string; path: string; change: 'added' | 'updated' | 'removed' | 'unchanged'; from?: string; to?: string };
  export interface SyncPlan {
    lock: Lock;                                   // the lock to write
    writes: Array<{ path: string; bytes: Buffer }>;
    removes: string[];
    changes: SyncChange[];
    refused: Array<{ path: string; reason: string }>;   // a person's file, an edited synced file, a config file
    skipped: Array<{ path: string; reason: string }>;   // files inside a unit that never sync (settings, hooks)
  }
  export async function planSync(registry: Registry, lock: Lock, read: (u: Upstream) => Promise<{ commit: string; reader: RepoReader }>, local: RepoReader): Promise<SyncPlan>;
  export async function applySync(top: string, plan: SyncPlan): Promise<void>;
  export function renderSync(plan: SyncPlan, format: 'text' | 'json' | 'markdown', applied: boolean): string;
  ```
- **What `planSync` does:**
  - **Units:** for each upstream and each declared unit, it scans the upstream at the commit, and finds the unit by path. A path that is no unit there, or a unit that is not a skill or a rule, is an `UpstreamError` (exit 2; D71).
  - **Files:** a unit's files are written as the upstream has them. In a skill, any file named `settings.json` or `settings.local.json`, and anything under a `hooks/` folder, is skipped (§7).
  - **What it refuses** (D50, D69):
    - a path the lock doesn't list that already exists locally;
    - a locked file whose local LF digest differs from the lock's (edited by hand).
  - **Removals:** a unit dropped from `units:`, or one gone from the upstream, has exactly its locked files removed. A locked file that was edited is refused, not removed.
- **`ctxlock sync [dir] [--dry-run] [--format text|json|markdown]`:**
  - It needs a git repository. It writes nothing when anything is refused (exit 1) or with `--dry-run`.
  - After writing, it runs `build`'s fill, so each synced skill reaches the other agent too.
  - It rewrites `ctxlock.lock` only when its content changed.
  - The cache is the same user cache folder `eval` uses.
  - The markdown output is the pull request body. It lists the changes, each upstream's old and new commit, and each refusal, all as code.

- [ ] **Step 1: Write the failing tests.** They use an org repository and a consumer built with `gitRepo`.
  - `adds a declared skill and a rule, at their paths, and pins commit, digests and tiers`;
  - `a second sync with nothing new upstream changes nothing, the lock included`;
  - `an upstream edit updates the files and the lock, and reports from-to digests`;
  - `a unit dropped from units, or deleted upstream, removes exactly its locked files` (Review Focus 1);
  - `refuses to write over a person's file, or a synced file edited by hand, and writes nothing` (Review Focus 2);
  - `a CRLF copy of an unchanged file is not a change` (Review Focus 4);
  - `skips settings.json and hooks/ inside an upstream skill, and says so` (Review Focus 5);
  - `a declared path that is no unit upstream, or an instructions file, exits 2 naming it` (Review Focus 3);
  - **renderer:** each format; markdown in code spans;
  - **CLI:** `sync`, `--dry-run`, exit codes, and the fill run afterwards.
- [ ] **Step 2: Run** `npx vitest run tests/sync tests/report/sync.test.ts tests/cli.test.ts -t "sync"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Document** `ctxlock sync` in `the-guide/commands.md`. **Commit** `feat: ctxlock sync brings shared skills and rules in from an upstream, pinned in ctxlock.lock`.

### Task 4: `L16-lock`

**Files:** Create `src/lint/rules/l16-lock.ts`, `tests/lint/l16-lock.test.ts`. Modify `src/lint/run.ts`, `the-guide/rules.md`, and the lint context, so that it carries the lock.

**Interfaces:**
- Consumes: `loadLock` (Task 1).
- **What it finds:**
  - **`must`:** a locked file whose working copy differs from the lock (LF digest), or is missing. The message reads: `<path> differs from ctxlock.lock (synced from <upstream> at <commit7>); change it upstream, or remove it from upstream units`.
  - **`should`:** a lock upstream or unit that `ctxlock.yaml` no longer declares (`run ctxlock sync`).
  - **`must`:** a `ctxlock.lock` that doesn't parse, with the `LockError` as the message.
- **Inside a pull request:** `diff` already reports new findings. A change to `ctxlock.lock` itself is just a changed file, reviewed through CODEOWNERS (D70).

- [ ] **Step 1: Write the failing tests:**
  - an edited synced file;
  - a missing synced file;
  - a clean sync with no finding;
  - an undeclared lock entry;
  - a broken lock;
  - CRLF only, with no finding.
- [ ] **Step 2: Run** `npx vitest run tests/lint/l16-lock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and register the rule.
- [ ] **Step 4: Run** `npx vitest run tests/lint`. Expected: PASS.
- [ ] **Step 5: Document** `L16` in `the-guide/rules.md`. **Commit** `feat: L16-lock catches synced files edited by hand`.

### Task 5: Tiers from the lock, and blast radius across repositories

**Files:** Modify `src/graph/graph.ts`, `src/lint/rules/l15-graph.ts`, `src/report/graph.ts`, `src/cli.ts`, and the tests of each.

**Interfaces:**
- Consumes: `Lock` (Task 1).
- Produces:
  ```ts
  GraphInput.lock?: Lock     // graph.tier(id) = the lock's tier for a synced unit (D72), else as today
  export interface Pin { repo: string; lockPath: string; upstream: string; unit: string; digest: string }
  export function pinnedBy(changed: string[], locks: Array<{ repo: string; path: string; lock: Lock }>): Pin[];
  Impact.pinned?: Pin[]
  ```
- **`ctxlock impact … --locks <path>…`:**
  - It finds every `ctxlock.lock` under each path, as it is on disk.
  - It names each lock's repository by that folder's `git remote get-url origin`, falling back to the folder's path.
  - A pin matches a changed unit when the lock's upstream `repo` is this repository's `origin` or its path, and the unit `path` matches.
  - It adds a section:
    ```
    Pinned by other repositories:
      <repo>  <unit path>  at <digest 12>  from <upstream name>
    ```
    In markdown, every name is code.

- [ ] **Step 1: Write the failing tests:**
  - `L15` reads a synced unit's tier from the lock, and a consumer's `units:` entry can't raise it;
  - `pinnedBy` matches by upstream repository and path, and ignores locks of other upstreams;
  - `impact --locks` over two consumer repositories names the one that pins the changed unit (the spec's exit criterion, in small).
- [ ] **Step 2: Run** `npx vitest run tests/graph tests/lint/l15-graph.test.ts tests/cli.test.ts -t "impact|tier|pinned"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: synced units keep their upstream tier, and impact names the repositories that pin a change`.

### Task 6: `ctxlock report`

**Files:** Create `src/collect/report.ts`, `tests/collect/report.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`, `the-guide/collector.md`.

**Interfaces:**
- Consumes: `joinSessions` and `Sessions` (Plan 5).
- Produces:
  ```ts
  export interface Report { version: 1; repo: string; harness: 'claude-code'; from: string | null; to: string | null; sessions: number;
    units: Array<{ id: string; digest: string | null; sessions: number; lastSeen: string; predicted: boolean }>; collectorErrors: number }
  export function buildReport(s: Sessions, scan: ScanResult, repo: string): Report;
  ```
  - `digest` is the unit's current digest, or `null` when no unit has that ID now.
  - **`ctxlock report [dir] [--out <file>]`** writes the JSON to `--out`, or to stdout.
  - It contains no paths outside the repository, no session IDs and no error messages (D74).

- [ ] **Step 1: Write the failing tests:**
  - the report's exact keys;
  - no session ID, path or error message anywhere in it;
  - the repository named by `origin`, else by the folder's name;
  - `--out` writes the file.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS. **Commit** `feat: ctxlock report exports loads for the org repository, with nothing local in it`.

### Task 7: The workflow, the live demo, docs and decisions

**Files:**
- Create: `templates/ctxlock-sync.yml`, `the-guide/propagation.md`, `docs/dogfood/<date>-propagation.md`, `journey/13-propagation.md`.
- Modify: `the-guide/README.md`, `README.md`, `journey/README.md`, `journey/decisions.md`, and this plan's progress table.

- [ ] **Step 1: The workflow template.** A scheduled and manual workflow, as `ctxlock-sync.yml`. It:
  1. runs `ctxlock sync --format markdown > body.md`;
  2. if anything changed, commits to the branch `ctxlock/sync` with the bot identity;
  3. opens or updates one pull request with `gh pr create --body-file` (or `gh pr edit`), using `GITHUB_TOKEN`, with the permissions `contents: write` and `pull-requests: write`.

  Its test runs the template's shell steps against a stand-in `gh`, as `tests/action.test.ts` does for the Action.
- [ ] **Step 2: The live demo** (D75), under `F:/ctxlock-live/propagation/`:
  - **The repositories:** an org repository with a skill and a rule, and two consumers, one taking the skill and one taking both.
  - **The sync:** sync both consumers. Then edit the rule upstream, and run `ctxlock impact --base HEAD~1 --locks <both consumers>` in the org repository. Expected: only the consumer that takes the rule is named.
  - **The second sync:** sync that consumer again, and check that `diff` against its previous commit shows the change, and that `L16` is clean.
  - **A hand edit:** edit a synced file by hand, and expect `L16` (must) and a `sync` refusal.
- [ ] **Step 3: Write the docs:**
  - `the-guide/propagation.md`: the org repository, `upstream:`, `sync`, the lock, the workflow, and what never syncs;
  - the dogfood report;
  - journey chapter 13;
  - D68–D75 in the decision log;
  - the README's roadmap line.
- [ ] **Step 4: Commit** `docs: propagation, live; journey chapter 13, decisions D68–D75`.

## After this plan

- A fresh review of the whole plan's range, then the finishing steps, as in Plans 2–5.
- A GitHub demo of the workflow, with Satyam's OK for each repository and pull request (D75).
- Next: Phase 3, the compounding loop.
