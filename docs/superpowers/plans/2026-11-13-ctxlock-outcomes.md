# ctxlock outcomes and verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close Phase 3's loop.
- **`ctxlock outcomes`:** finds the fixes that shipped, says whether each held at 7 and 30 days, keeps helpful and harmful counts per unit version, and gives the compounding numbers.
- **`ctxlock verify`:** re-checks a unit by its probes when its `stale-after` has passed.

**Architecture:**
- **What counts as shipped:** a fix is shipped when a commit adds the probe `diagnose` wrote for it, which is the probe id `miss-…`. ctxlock reads that from git history, never from its own state.
- **Durability and the counters:** joined from what `misses` already reads, the collector's loads and the transcripts' signals, with each load's bytes kept.
- **Re-checking:** both `verify` and `outcomes --verify` run probes on the repository as it is, one side only, through eval's `runProbes`.

**Tech Stack:** TypeScript 7, Node ≥ 22 ESM, vitest, zod 4, yaml, commander, git. No new runtime dependency.

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- §6 Phase 3: "Monitoring. Durability at 7 and 30 days, helpful/harmful counters per unit, re-verification when `stale-after` passes. Metrics: time-to-fix, regression rate, fixes × consumers reached, units never loaded (candidates for deletion). Exit: an end-to-end demo from a real miss to a shipped fix in N consumers, with each step timed."
- §8 Phase 3.
- §4.1 (`verified-at`, `stale-after`).

It builds on Plan 7 ([misses](2026-11-11-ctxlock-misses.md)) and Plan 8 ([diagnose](2026-11-12-ctxlock-diagnose.md)).

Satyam asked on 2026-11-13 to "continue the work" without design questions. Every call below that the spec leaves open is marked as mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `425bb14` |
| 2 | Done | `56ffeaf` |
| 3 | Done | `1d9db8d` |
| 4 | Done | `b0ebc1c` |
| 5 | Done | `08a0388`, and the docs commit |

## Rulings this plan makes (my calls)

Each also goes into `journey/decisions.md` in Task 5.

- **D89. Two commands.**
  - **`ctxlock outcomes`** reads only: git history, the collector's events and the transcripts. It runs no agent unless asked with `--verify`.
  - **`ctxlock verify`** runs Claude Code, as `eval` does.
  - Neither writes into the repository. `verify` prints the `ctxlock.yaml` lines to change, since `verified-at` is the owner's record (§7: agents never set what owners decide).
  - *If wrong:* a `--write` on `verify`.
- **D90. A fix is shipped when a commit reachable from `HEAD` adds a probe whose id starts with `miss-`,** the id `diagnose` gives it (Plan 8's proposal says to commit the probe with the fix).
  - **The commit:** the first commit, oldest first, whose diff adds that id under `evals/probes/` (`git log --reverse -S<id>`). Its committer date is the ship time.
  - **The unit's versions from then on:** the bytes of its first file at that commit, and at every later commit that touched that file, up to `HEAD`, plus the working tree's.
    - Each is kept two ways: as the file's LF digest, which is what the collector's loads compare against, and as the unit's digest, which is what locks pin.
  - **Edge cases:**
    - A probe that names no current unit is listed apart.
    - A commit that adds the probe but leaves the unit unchanged is shipped, with a note.
    - In a shallow clone, history can't say when a probe arrived, so `outcomes` is exit 2, naming `git fetch --unshallow`.
    - Outside git there are no shipped fixes, only the counters.
  - *If wrong:* a `ctxlock.lock`-style record of shipped fixes.
- **D91. Durability at 7 and 30 days is judged from sessions that saw the fix.**
  - **What counts as seeing it:** a session saw the fix when it loaded the unit with the bytes of one of its versions from the fix on (D90).
  - **Sessions not judged:**
    - one that loaded other bytes (an old branch);
    - one with unknown bytes (a skill call, a predicted load, a load the collector couldn't hash).
  - **Each window,** from the ship time to 7 (or 30) days after it, is one of:
    - `missed again`: such a session had a signal with the unit in context, as `misses` joins them. Its count is given.
    - `held`: such sessions came, with no signal. Their count is given.
    - `no sessions`: none came.
    - `pending`: the window hasn't closed. It also says how it stands so far.
  - *If wrong:* weigh `missed again` by sessions, as routing does.
- **D92. Helpful and harmful counts are per unit and per version loaded,** ACE's counters applied to exposure:
  - **The version:** a session's version is the LF digest of its first observed load of the unit; unknown bytes are their own row.
  - **Harmful:** the session had a signal with the unit in context, counted at half when every such signal came after web or MCP content, as `misses` counts them (D81).
  - **Helpful:** the session loaded it and had no such signal.
  - **Signals from before the collector recorded the session** count for neither.
  - **The words:** the output names them, then says what they mean, "in context at a signal" and not proven harm.
  - *If wrong:* per digest of the whole unit; today single-file units are most units.
- **D93. The numbers** (§8), each with its count and none invented:
  - **Median time to fix:** from the first signal with the unit in context, before the ship time, to the ship time. A fix with no recorded signal before it has no time, and is counted apart.
  - **Regression rate:** among fixes whose 7-day window has closed and was judged, the share `missed again` in either window. With `--verify`, a fix whose probe fails today also counts.
  - **Durability at 30 days:** among fixes whose 30-day window has closed and was judged, the share `held`.
  - **Fixes × consumers reached:** for each fix, the consumers of its unit in `ctxlock.yaml` (as `who-uses` reaches them), plus, with `--locks <folders…>`, each repository whose `ctxlock.lock` pins the unit at one of its versions from the fix on, summed.
  - **Never loaded:** units no recorded session loaded, of the units sessions could have loaded, with the session count beside it. `ctxlock loads` lists them.
  - *If wrong:* each number is its own function, so one can change alone.
- **D94. `verify` re-checks the units whose `stale-after` has passed, today in local time as `L9` reads it, or one named with `--unit`, by their own probes,** on the repository as it is: the working tree, without `CLAUDE.local.md`.
  - **One side only:** a run of the head side, through `runProbes` with `arms: ['head']`. It defaults to `--runs 3`, so that 3 of 3 is the result.
  - **Each unit is one of:**
    - `holds`: every probe had at least 2 valid runs, all passed;
    - `fails`: some valid run failed;
    - `inconclusive`: a budget cut it, or a probe had fewer than 2 valid runs;
    - `no probes`: `probe draft` can draft some.
  - **For each unit that holds,** it prints the lines to set: `verified-at` today, and `stale-after` today plus the unit's own interval (its `stale-after` minus its `verified-at`), or 90 days when either is missing.
  - **`outcomes --verify`** runs each shipped fix's probe the same way. One that fails is a regression (D93).
  - *If wrong:* a stricter bar than all passing, if probes prove flaky.
- **D95. The exit demo** runs on local repositories in `F:/ctxlock-live/outcomes`:
  - an org repository whose rule causes a planted miss, recorded in the org repository's own session;
  - `diagnose`, the person applying its diff and committing it with the probe;
  - two consumers that `sync` the unit.

  `outcomes` then finds the fix, its time to fix, and 2 consumers reached, with every step timed. The 7- and 30-day windows show as `pending` live; the tests cover them closed. Nothing goes to GitHub.
  - **Not in this plan:** a miss recorded in a consumer and fixed upstream joins two repositories' records. That waits for the org tier (D67).
  - *If wrong:* the same commands run on real misses as they come.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- **Nothing is written into the repository.** `outcomes` makes no network call and runs no agent without `--verify`.
- **Runs are eval's runs:** every action denied, the copy's hooks and settings stripped, a run that changes a file stops everything. `verify` and `outcomes --verify` take `--runs`, `--max-runs` (default 16), `--max-minutes` (default 15), `--model`, `--claude` and `--workdir` as `diagnose` does.
- **Output names sessions only in JSON,** as `misses` does. Nothing a person typed is printed.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push to `main` after each task and watch CI on both operating systems.

## Review Focus

1. **A unit edited again after its fix:** sessions loading the later bytes still saw the fix, and are judged (Task 1's versions, Task 2's test).
2. **Commit dates in another time zone, and windows across a month's end:** windows are instants, from `%cI`, never local dates (Task 2).
3. **A shallow clone or a folder outside git:** exit 2 naming `git fetch --unshallow`, or no fixes with the counters still shown (Task 1, Task 3).
4. **A probe id added, removed, and added again, or edited later:** the first commit that added it is the ship time (Task 1).
5. **`verify` on a unit with probes on other units, or none:** only its own probes run, and `no probes` says how to get some (Task 4).

## Files

| File | Responsibility |
|---|---|
| `src/collect/sessions.ts` | `SessionLoad.sha256`: the bytes each load saw |
| `src/loop/fixes.ts` | `shippedFixes`: fixes from git history, with their versions |
| `src/loop/outcomes.ts` | `durability`, `counters`, `numbers` |
| `src/report/outcomes.ts` | `renderOutcomes`, `renderVerify` |
| `src/eval/eval.ts` | `runProbes`'s `arms` option |
| `src/loop/verify.ts` | `dueUnits`, `verifyProbes`, `nextDates` |
| `src/cli.ts` | `ctxlock outcomes`, `ctxlock verify` |

---

### Task 1: Shipped fixes from git

**Files:** Create `src/loop/fixes.ts`, `tests/loop/fixes.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export class FixesError extends Error {}
  export interface Version { commit: string | null; at: string | null; file: string; unit: string } // file: LF digest of the unit's first file; unit: unitDigest. commit null = the working tree
  export interface ShippedFix { probe: Probe; unit: string; commit: string; shippedAt: string; unchanged: boolean; versions: Version[] }
  export interface Fixes { fixes: ShippedFix[]; orphans: Probe[]; git: boolean }
  export async function shippedFixes(root: string, scan: ScanResult): Promise<Fixes>;
  ```
- **How it runs:**
  - Probes come from `loadProbes(fsReader(root))`, keeping ids starting `miss-`.
  - The commit comes from `git log --reverse --format=%H%x09%cI -S<id> -- evals/probes`, taking the first line.
  - Bytes at a commit come from `git show <commit>:<path>`, through `gitReader`.
  - A unit's digest at a commit is `unitDigest` over its current file list read at that commit. A file missing there drops that version.
- **What makes it refuse:** `git rev-parse --is-shallow-repository` saying `true` is a `FixesError` naming `git fetch --unshallow`. No git top level gives `{ fixes: [], orphans: [], git: false }`.

- [ ] **Step 1: Write the failing tests.** They use `gitRepo`, with `GIT_COMMITTER_DATE` stubbed per commit.
  - `a commit that adds a miss- probe ships its fix, at that commit's time, with the unit's bytes from then on`: three commits (the rule; the fix and its probe; a later edit to the rule). Expected: one fix, `commit` = the second commit, `shippedAt` its `%cI`, `versions` the second commit's bytes, the third's and the working tree's, `unchanged: false`.
  - `the first commit that added the id is the ship time, though the probe was edited and re-added later` (Review Focus 4).
  - `a probe that names no unit is an orphan, a commit that adds the probe alone is unchanged, and a probe whose id is not miss- is no fix`.
  - `a shallow clone is a FixesError naming git fetch --unshallow, and a folder outside git has no fixes` (Review Focus 3). Clone with `git clone --depth 1 file://…`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/fixes.test.ts`. Expected: FAIL, the module missing.
- [ ] **Step 3: Implement** `shippedFixes` in `src/loop/fixes.ts`.
- [ ] **Step 4: Run** it. Expected: PASS. Mutation-check. **Commit** `feat: find a diagnosed fix shipped when its probe was committed`.

### Task 2: Durability and the counters

**Files:** Modify `src/collect/sessions.ts`, `tests/collect/sessions.test.ts`. Create `src/loop/outcomes.ts`, `tests/loop/outcomes.test.ts`.

**Interfaces:**
- Consumes: `ShippedFix` (Task 1), `Timeline` and `sessionTimelines` (`src/collect/sessions.ts`), `Misses['found']` (`src/loop/misses.ts`, each `MissSignal` with `session`, `ts`, `context`, `untrusted`, `unrecorded`).
- Produces:
  ```ts
  // In SessionLoad: the loaded file's digest as the collector recorded it; null for a skill call, a predicted load or a file it couldn't hash.
  sha256: string | null;

  export type WindowStatus = 'held' | 'missed again' | 'no sessions' | 'pending';
  export interface Window { days: 7 | 30; status: WindowStatus; sessions: number; missed: number }
  export function durability(fix: ShippedFix, timelines: Timeline[], found: MissSignal[], now: Date): Window[];
  export interface Counter { unit: string; version: string | null; today: boolean; fixed: boolean; helpful: number; harmful: number }
  export function counters(timelines: Timeline[], found: MissSignal[], scan: ScanResult, fixes: ShippedFix[]): Counter[];
  ```
- **The window:** `(shippedAt, shippedAt + days]`, compared as `Date` instants. A session is in a window when its first load of the unit at a fixed version falls inside it. `pending` keeps `sessions` and `missed` so far.
- **The signal:** one counts when its `context` holds the unit, its session saw the fix, and its time is after that load, inside the window. An `unrecorded` signal never counts.
- **The counter's flags:** `today` marks the version equal to the scanned unit's first file. `fixed` marks one in a fix's `versions`.

- [ ] **Step 1: Write the failing tests.**
  - **The sessions:** `each load keeps the digest the collector recorded, and a skill call or a predicted load has none`.
  - **Durability:**
    - `a fix with sessions that saw it and no signal held; one with a signal in the window missed again; one with no session in a closed window has no sessions`.
    - `a window not yet closed is pending, with how it stands so far`.
    - `a session on the bytes of a later edit saw the fix, one on the old bytes or unknown bytes is not judged` (Review Focus 1).
    - `windows are instants: a fix shipped at 23:30 at -05:00 on the 31st closes its 7-day window seven days later to the minute` (Review Focus 2).
  - **The counters:**
    - `each version of a unit counts helpful and harmful sessions, a session with only untrusted signals counts half, and an unrecorded signal counts for neither`.
    - `the version loaded today and a fix's version are marked`.
- [ ] **Step 2: Run** `npx vitest run tests/collect/sessions.test.ts tests/loop/outcomes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** them. Expected: PASS. Mutation-check. **Commit** `feat: say whether a shipped fix held at 7 and 30 days, and count each version's sessions`.

### Task 3: The numbers and `ctxlock outcomes`

**Files:** Modify `src/loop/outcomes.ts`, `src/cli.ts`, `tests/loop/outcomes.test.ts`, `tests/cli.test.ts`. Create `src/report/outcomes.ts`, `tests/report/outcomes.test.ts`.

**Interfaces:**
- Consumes: Tasks 1 and 2; `missesAt`, `recordedAt` and `sessionsAt` in `src/cli.ts`; `buildGraph` and `whoUses` (`src/graph/graph.ts`); `loadLock` (`src/sync/lock.ts`) and `locksUnder`, the `--locks` folder walk in `src/cli.ts` that `impact --locks` uses, moved out of the action into a function both commands call.
- Produces:
  ```ts
  export interface FixOutcome { fix: ShippedFix; firstSignal: string | null; daysToFix: number | null; windows: Window[]; consumers: string[]; pinnedBy: string[]; probe?: 'holds' | 'fails' | 'inconclusive' }
  export interface Numbers {
    medianDaysToFix: number | null; timed: number;
    regressed: number; judged7: number;
    held30: number; judged30: number;
    reached: number;
    neverLoaded: number; loadable: number; sessions: number;
  }
  export function numbers(outcomes: FixOutcome[], sessions: Sessions): Numbers;
  export interface Outcomes { sessions: number; since?: string; git: boolean; fixes: FixOutcome[]; orphans: string[]; counters: Counter[]; numbers: Numbers }
  export function renderOutcomes(o: Outcomes, format: 'text' | 'json'): string;
  ```
- **The command:** `ctxlock outcomes [dir] [--format text|json] [--since YYYY-MM-DD] [--locks <folders...>]`.
  - **Exit codes:** exit 0 always, unless `FixesError` or a bad flag, which are exit 2.
  - **Text sections:** "Shipped fixes" (each with its ship date, short commit, first signal, and each window); "Helpful and harmful, by the version loaded"; "The numbers".
  - **An empty state:** with no shipped fix it says `No shipped fix: a fix ships when the probe ctxlock diagnose wrote for it is committed.`

- [ ] **Step 1: Write the failing tests.**
  - **The numbers:**
    - `the median time to fix counts only fixes with a recorded signal before them, the regression rate only judged closed windows, and durability at 30 days only judged closed 30-day windows`.
    - `consumers reached sum each fix's declared consumers and the repositories whose lock pins it at a fixed version, not an older one`.
  - **The renderer:**
    - `text gives each fix's windows, the counters and the numbers, and json carries them, with sessions named only there`.
    - `with no fix it says how a fix ships`.
  - **The command:**
    - `outcomes finds a fix committed with its probe, its time to fix from the recorded signal, and a window pending`.
    - `outcomes outside git still counts each version's sessions` (Review Focus 3).
    - `outcomes in a shallow clone is exit 2 naming git fetch --unshallow`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/outcomes.test.ts tests/report/outcomes.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** them. Expected: PASS. Mutation-check. **Commit** `feat: ctxlock outcomes gives each shipped fix's durability and the compounding numbers`.

### Task 4: Re-verification: `ctxlock verify` and `outcomes --verify`

**Files:** Modify `src/eval/eval.ts`, `tests/eval/eval.test.ts`, `src/cli.ts`, `tests/cli.test.ts`, `src/report/outcomes.ts`. Create `src/loop/verify.ts`, `tests/loop/verify.test.ts`.

**Interfaces:**
- Consumes: `runProbes` (`src/eval/eval.ts`), `loadProbes`, `localDate` (`src/scan.ts`), the registry's `verifiedAt` and `staleAfter`.
- Produces:
  ```ts
  // In runProbes' options: the arms to run, by default both. An arm not run is null in each outcome, and the status is eval's for a missing arm, inconclusive.
  arms?: readonly ArmName[];

  export type Check = 'holds' | 'fails' | 'inconclusive' | 'no probes';
  export function judgeHead(arms: Array<ArmResult | null>): Exclude<Check, 'no probes'>;
  export function dueUnits(scan: ScanResult, today: string): Unit[];
  export function nextDates(verifiedAt: string | undefined, staleAfter: string | undefined, today: string): { verifiedAt: string; staleAfter: string };
  export type VerifyOptions = { runs: number; maxRuns: number; maxMinutes: number; model: string; claude: string[]; workdir: string };
  export interface UnitCheck { unit: Unit; check: Check; probes: ProbeOutcome[]; next?: { verifiedAt: string; staleAfter: string } }
  export async function verifyProbes(root: string, scan: ScanResult, units: Unit[], opts: VerifyOptions): Promise<{ checks: UnitCheck[]; runs: number }>;
  export function renderVerify(r: { checks: UnitCheck[]; runs: number }, format: 'text' | 'json'): string;
  ```
- **The commands:**
  - `ctxlock verify [dir] [--unit <ref>] [--format text|json] [--runs <n>] [--max-runs <n>] [--max-minutes <n>] [--model] [--claude] [--workdir]`. `--runs` defaults to 3 and must be at least 2. It exits 0 unless a unit `fails`, which is exit 1.
  - `outcomes --verify` takes the same run flags, and adds `probe` to each `FixOutcome`.
- **The YAML it prints for a unit that holds:**
  ```
  In ctxlock.yaml:
    units:
      .claude/rules/deps.md:
        verified-at: 2026-11-13
        stale-after: 2027-02-11
  ```

- [ ] **Step 1: Write the failing tests.**
  - **The runner:** `runProbes with arms head runs only the head copy, and its outcome has no base` (counting the fake's argv log).
  - **The judgement:**
    - `judgeHead holds only when every probe passed in at least 2 valid runs, fails on any failed valid run, and is inconclusive otherwise`.
    - `nextDates keeps the unit's own interval, or 90 days when it has none` (crossing a year's end).
    - `dueUnits are those whose stale-after is before today`.
  - **The command:**
    - `verify runs only a due unit's own probes, prints the lines for one that holds, and is exit 1 for one that fails` (Review Focus 5).
    - `verify --unit names one unit due or not, and a unit with no probes says probe draft can draft some`.
    - `outcomes --verify counts a fix whose probe fails today as a regression`.
- [ ] **Step 2: Run** `npx vitest run tests/eval/eval.test.ts tests/loop/verify.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** them. Expected: PASS. Mutation-check. **Commit** `feat: ctxlock verify re-checks a unit by its probes when stale-after passes`.

### Task 5: The exit demo, docs and decisions

**Files:**
- Create `docs/dogfood/2026-11-13-outcomes.md`, `journey/16-outcomes.md`, `the-guide/outcomes.md`, and `F:/ctxlock-live/outcomes/`, outside the repository.
- Modify `the-guide/commands.md`, `the-guide/README.md`, `README.md`, `journey/README.md`, `journey/decisions.md`, and this plan's progress table.

- [ ] **Step 1: The exit demo (D95), each step timed:**
  1. **The setup:** the org repository's rule says npm and its `package.json` names pnpm, and a session in it is planted in Claude Code's shape.
  2. **Find and diagnose:** `misses --min-sessions 1`, then `diagnose` with real Claude Code.
  3. **The person's part:** apply the proposed diff by hand, add the probe under `evals/probes/`, and commit.
  4. **Reach:** two local consumers run `sync`.
  5. **The result:** `outcomes --locks <the consumers' folder>`.
  6. **Re-check:** `verify --unit` on the fixed rule, with real Claude Code.
  - **Record:** each step's seconds; the fix's time to fix; the consumers reached; the windows; verify's result and runs. Nothing goes to GitHub.
- [ ] **Step 2: Docs.**
  - **`the-guide/outcomes.md`:** what ships a fix, durability, the counters and what "harmful" means, the numbers and how each is counted, `verify`, and what it doesn't do yet.
  - **Commands:** sections in `commands.md`, a row in the guide's index, and the README's "What it can do today" item and roadmap sub-item.
  - **The journey:** `journey/16-outcomes.md`, and D89–D95 in `journey/decisions.md`.
- [ ] **Step 3: Run** `npm run ci`. Expected: PASS. **Commit** `docs: ctxlock outcomes and verify in the guide, the exit demo, and D89-D95`, push, and watch both operating systems' CI.

## After this plan

- **Phase 3's later parts:** clustering signals across users; the other signals (rejected tool uses, abandoned sessions, a skill not loaded); and replay with a unit taken out.
- **Joining across repositories:** a miss recorded in a consumer, fixed upstream. This waits for the org tier.
- **Phase 4.**
