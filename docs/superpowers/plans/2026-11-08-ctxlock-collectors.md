# ctxlock collectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which units Claude Code actually loads in developers' own sessions, and show it. A Claude Code plugin in this repository records each load as a line of JSON on the developer's machine. `ctxlock loads` lists, per unit:
- the sessions that loaded it, how, and when last;
- the units the prediction says can load that no session did.

`ctxlock who-uses` adds the observed sessions beside the predicted loads.

**Architecture:**
- **The collector** is `plugin/collect.mjs`, a dependency-free Node script.
  - It runs on the hooks `SessionStart`, `InstructionsLoaded` and `PostToolUse` (Skill).
  - It appends one line per event to `~/.ctxlock/events/<YYYY-MM>.jsonl`.
- **The commands** read those lines, keep the sessions and files inside the repository, and join them to a fresh scan by path and digest. This is S4's join, shared with `ctxlock eval`'s `joinLoads`.
- **Nothing is stored** beyond the lines themselves. As with the graph (D60), every query starts from a scan.

**Tech Stack:** as in Plans 1–4: TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, vitest. **No new runtime dependency.** The plugin is plain JavaScript using Node built-ins.

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- §4.3 (`context.load`);
- §4.4 (`loaded` edges);
- §5 (Collectors);
- §6 Phase 2 (observed edges; exit: "Observed edges match `InstructionsLoaded` ground truth");
- §7 ("Collectors store IDs and digests only, never content").

**Evidence:** [S4](../../spikes/S4-telemetry.md) (the join keys, the `AGENTS.md` gap) and [S5](../../spikes/S5-collector-plugin.md) (the plugin, its payloads, where to store events).

This is Phase 2's second plan. The next one is the org context repository, with `ctxlock sync`, `ctxlock.lock` and `ctxlock report`.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `34f0c85` |
| 2 | Done | `2d1b519` (the CRLF fix), `bab4b42` |
| 3 | Done | `a1db050` |
| 4 | Done: exact match on S4's fixture, and plano ([report](../../dogfood/2026-11-08-collector.md)) | `b2aa97e` |
| Final review | Done. No critical finding. Two important ones fixed, each with a test that failed first: a fallback `AGENTS.md` below the top, and sessions started in a subfolder. Two minors re-graded important and fixed: verbatim output in the report, and exact statements of what is recorded ([chapter 12](../../../journey/12-collector.md#what-broke)) | `490e269`, the docs commit |

**Deferred from the final review** (minor, not fixed):
- `M3`: the collector relies on `hooks.json`'s exact `Skill` matcher for D66. A `tool_name === 'Skill'` check in `collect.mjs` would keep the guarantee if matcher rules ever changed.
- `M4`: event paths aren't canonicalized, only the roots are. A session started through a junction or an 8.3 name, while `loads` runs on the real path, doesn't match, nor does a nested path whose case differs below the root.
- `M5`: a line cut short with no newline joins the next line written, so that complete line is lost too.
- `M7`: `who-uses` exits 2 when `~/.ctxlock/events` exists but is a file. A static query shouldn't depend on the collector's store.
- `M8`: collector errors and unread lines are counted across the whole store, with no date. One old error shows in every repository's `loads`.
- `M9`: when the collector is installed but no session matched the folder, `loads` still prints the install commands.
- `M10`: "What it can't see" doesn't cover skills a person invokes by typing `/name`, which probably fire no Skill tool call (unverified), nor a project skill shadowed by a personal one of the same name.
- `M11`: `bySession` copies its array on every event, and `renderLoads`'s header repeats the pluralization that `sessions()` already does.

## Rulings this plan makes

Each also goes into `journey/decisions.md` in Task 4, as D63–D67.

- **D63. The collector is a Claude Code plugin named `ctxlock`, in this repository's `plugin/` folder, and the repository is its own marketplace.**
  - It installs with `claude plugin marketplace add SatyamSingh-Git/ctxlock`, then `claude plugin install ctxlock@ctxlock`, or the same as `/plugin` commands. Writing hooks into a user's settings would be more intrusive and harder to remove.
  - `plugin.json` has no `version`, so every commit is a new version for `claude plugin update`. If `claude plugin validate` requires one, use `package.json`'s version and ledger the ruling.
  - *If wrong:* a version to bump with each release.
- **D64. Events go to `<home>/events/<YYYY-MM>.jsonl`.** `<home>` is `$CTXLOCK_HOME`, else `.ctxlock` in the user's home folder.
  - One store serves every repository, and it sits outside all of them, so it can't be committed.
  - Not `CLAUDE_PLUGIN_DATA`: its folder name depends on how the plugin was installed (S5).
  - *If wrong:* a store per repository, and a move.
- **D65. Events are joined to units when a command runs, never stored as edges.** Same as D60: no SQLite.
  - A load matches a unit by its path today. A renamed unit's history stays with its old path.
  - *If wrong:* a store of joined edges, which the org tier will need anyway.
- **D66. The collector records only what the join needs, and never gets in a session's way.**
  - **What it records:** the session ID, `cwd` and time; a loaded file's path, digest, reason, trigger and parent; a skill's name.
  - **What it never records:** content, prompts, other tool input, tool output, or its environment, which holds the parent process's tokens (S5).
  - **How it fails:** it prints nothing (a `SessionStart` hook's output becomes context), and exits 0 on any input. A failure becomes an `error` line, which `ctxlock loads` reports.
  - *If wrong:* a missing field means a new event version.
- **D67. What waits for other plans:**
  - `ctxlock report` and implicit consumers across repositories wait for the org context repository that receives them (Plan 6).
  - Collectors for Codex, Copilot CLI and Cursor wait for access to those tools, as Codex's evals do.
  - `context.outcome` events and the other signals belong to Phase 3 (§6).
  - Reading past sessions from Claude Code's transcripts, as agentsview does, is not in this plan.
  - Within one repository, `ctxlock loads` says when no declared consumer covers the sessions it saw (§4.2). Its JSON already has the shape a report would share: counts per unit, and no session IDs.
  - *If wrong:* `report` moves earlier, as a file writer.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- **`plugin/collect.mjs`** is plain JavaScript using only Node built-ins. Claude Code runs it from the installed plugin's folder, so it is not compiled or bundled.
- **What the collector records** is exactly Task 1's line format. Never file content, prompts, tool input other than a skill's name, tool output, or environment variables (§7).
- **The collector writes nothing to stdout,** and exits 0 on every input.
- **Commands write nothing:** not to the repository, not to the event store. `loads` exits 0, or 2 when it cannot run.
- **Output paths** are POSIX paths from the repository's top. Text output shows dates as `YYYY-MM-DD`, in UTC.
- **A load Claude Code reports is "observed"; one ctxlock infers is "predicted"** (§9).
- Code style: `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test.

## Review Focus

1. **Two sessions append to the same month's file at once, or a line is cut short:** a line that doesn't parse is skipped and counted, and every other line is read (Task 2).
2. **A session started in a subfolder of the repository, and a load of a file outside it** (`~/.claude/CLAUDE.md`): the session counts, and the outside file is never listed (Task 2).
3. **Paths that differ from the repository's only in separators or drive-letter case** (`f:\repo\CLAUDE.md` against `F:\repo`): they still match (Task 2).
4. **A file edited after a session loaded it:** the load counts for the unit, as another version (Task 2).
5. **No collector installed, so no events folder:** `loads` exits 0 and says how to install it, and `who-uses` shows no observed section (Task 3).

## Files

| File | Responsibility |
|---|---|
| `plugin/collect.mjs`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/plugin.json` | The collector |
| `.claude-plugin/marketplace.json` | This repository as the plugin's marketplace |
| `src/collect/events.ts` | `eventsHome`, `readEvents` |
| `src/collect/sessions.ts` | `joinSessions`: recorded events joined to a scan |
| `src/eval/loads.ts` | The join shared with `joinLoads`: `unitsByPath`, `loadReason`, `fallbackLoads` |
| `src/report/loads.ts` | `renderLoads` |
| `src/graph/graph.ts`, `src/report/graph.ts` | `WhoUses.observed`, and its section |
| `src/cli.ts` | `ctxlock loads`, and observed sessions in `who-uses` |

---

### Task 1: The collector plugin

**Files:**
- Create: `plugin/collect.mjs`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `tests/plugin/collect.test.ts`

**Interfaces:**
- Produces: the event line format. Task 2 reads it. Each event is one line, appended to `<home>/events/<ts.slice(0, 7)>.jsonl`, with `<home>` as D64 sets it. A line carries these keys, in this order, and no others:
  ```
  {"v":1,"ts":"<ISO, UTC>","harness":"claude-code","session":"<session_id>","cwd":"<cwd>","event":"session_start","source":"<source>"}
  {"v":1,"ts":…,"harness":…,"session":…,"cwd":…,"event":"load","file":"<file_path>","sha256":"<hex>"|null,"reason":"<load_reason>","trigger":"<trigger_file_path>","parent":"<parent_file_path>"}
  {"v":1,"ts":…,"harness":…,"session":…,"cwd":…,"event":"skill","skill":"<tool_input.skill>"}
  {"v":1,"ts":"<ISO>","event":"error","message":"<message>"}
  ```
  - `trigger` and `parent` appear only when the payload has them.
  - `sha256` is the hex SHA-256 of the file's bytes with CRLF read as LF, as `lfDigest` hashes them, so it equals a scanned `UnitFile.sha256`. It is `null` when the file can't be read.
  - Paths are as Claude Code gives them.
  - Any other `hook_event_name` writes nothing.
  - Input that can't be parsed writes an `error` line.
- `hooks.json` runs `node "${CLAUDE_PLUGIN_ROOT}/collect.mjs"`, with `"timeout": 10`:
  - on `SessionStart`;
  - on `InstructionsLoaded`;
  - on `PostToolUse` with `"matcher": "Skill"`.
- `plugin.json`: `{"name":"ctxlock","description":…,"author":{"name":"Satyam Singh"},"homepage":"https://github.com/SatyamSingh-Git/ctxlock","license":"Apache-2.0"}`.
- `marketplace.json`: `{"name":"ctxlock","owner":{"name":"Satyam Singh"},"plugins":[{"name":"ctxlock","source":"./plugin","description":…}]}`.

- [ ] **Step 1: Write the failing tests** in `tests/plugin/collect.test.ts`. Each runs `node plugin/collect.mjs` with a payload on stdin and `CTXLOCK_HOME` set to a temporary folder.
  - **`records an InstructionsLoaded as a load: path, LF digest, reason and trigger, and nothing else`:**
    - The payload has every field S5 saw, including `memory_type`, `transcript_path` and `prompt_id`.
    - The file has CRLF endings.
    - The line's keys equal `['v','ts','harness','session','cwd','event','file','sha256','reason','trigger']`.
    - `sha256` equals `lfDigest` of the file's bytes.
  - **`records a Skill call by name only`:**
    - `tool_input` is `{skill: 'release', args: 'secret-args'}`, and `tool_response` holds `secret-output`.
    - The line has `skill: 'release'`.
    - The file contains neither secret.
  - **`records a session start with its source`.**
  - **`gives a file it cannot read a null digest`.**
  - **`files each event under the month it happened`:** the one file in `events/` is named `<line.ts.slice(0, 7)>.jsonl`.
  - **`writes nothing to stdout and exits 0, whatever it is given`.** Four inputs:
    - a valid payload;
    - text that isn't JSON, which gives one `error` line;
    - a `Stop` payload, which writes nothing;
    - a `CTXLOCK_HOME` that is a file, which can't be written.
  - **`the plugin's hooks run collect.mjs on SessionStart, InstructionsLoaded and Skill calls`.** It parses `hooks.json`, `plugin.json` and `marketplace.json`, and checks:
    - the three events;
    - the matcher;
    - the command;
    - `source: './plugin'`;
    - the plugin name `ctxlock` in both manifests.
- [ ] **Step 2: Run** `npx vitest run tests/plugin/collect.test.ts`. Expected: FAIL, because `plugin/collect.mjs` does not exist.
- [ ] **Step 3: Implement** the plugin files.
  - The script reads all of stdin, maps the payload to a line, and appends it with `appendFileSync`. It creates the folder first.
  - It wraps everything in one `try` and exits 0. The comment says why: a collector must never fail a session. On a failure, its `catch` tries to append the `error` line and ignores a second failure.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Validate** the manifests with Claude Code:
  - `claude plugin validate plugin` and `claude plugin validate .`;
  - then, as a check by hand, a `claude -p --plugin-dir plugin` session in a scratch repository with `CTXLOCK_HOME` set to a scratch folder.

  Expected: "Validation passed", and lines from that session in the scratch store.
- [ ] **Step 6: Commit** `feat: the collector, a Claude Code plugin that records which units load`.

### Task 2: Joining recorded sessions to units

**Files:**
- Create: `src/collect/events.ts`, `src/collect/sessions.ts`, `tests/collect/events.test.ts`, `tests/collect/sessions.test.ts`
- Modify: `src/eval/loads.ts`, `tests/eval/loads.test.ts`

**Interfaces:**
- Consumes: Task 1's line format.
- Produces:
  ```ts
  // src/collect/events.ts
  export type RecordedEvent =
    | { event: 'session_start'; ts: string; session: string; cwd: string; source?: string }
    | { event: 'load'; ts: string; session: string; cwd: string; file: string; sha256: string | null; reason: string; trigger?: string; parent?: string }
    | { event: 'skill'; ts: string; session: string; cwd: string; skill: string }
    | { event: 'error'; ts: string; message: string };
  export function eventsHome(env?: NodeJS.ProcessEnv): string;
  export function readEvents(home: string): { events: RecordedEvent[]; skipped: number };

  // src/collect/sessions.ts
  export interface UnitLoads {
    id: string; path: string;
    sessions: number;        // sessions that loaded it
    reasons: string[];       // sorted, as loadReason names them
    lastSeen: string;        // ts of its latest load
    otherVersion: number;    // sessions that loaded bytes other than the scanned unit's
    predicted: boolean;      // true when no session reported it: an AGENTS.md read through the fallback
  }
  export interface Sessions {
    sessions: number; first: string | null; last: string | null;
    units: UnitLoads[];      // by sessions, most first, then by path
    unseen: Array<{ id: string; path: string; mode: LoadMode }>;
    undeclared: boolean;     // sessions were seen, and no consumer runs on claude-code
    errors: { count: number; last?: string };
    skipped: number;
  }
  export function joinSessions(read: { events: RecordedEvent[]; skipped: number }, scan: ScanResult, roots: string[]): Sessions;

  // src/eval/loads.ts, shared by joinLoads and joinSessions
  export function unitsByPath(scan: ScanResult): Map<string, Unit>;
  export function loadReason(raw: string): string;
  export function fallbackLoads(scan: ScanResult, observed: Set<string>): Array<{ unit: Unit; reason: 'session_start' | 'import' }>;
  ```
- **`readEvents`** reads every `events/*.jsonl`, with zod checking each line.
  - It skips, and counts in `skipped`, any line that does not parse, has a `v` other than 1, or has an unknown `event`.
  - It drops `v` and `harness`.
  - A missing `events/` folder gives `{ events: [], skipped: 0 }`.
- **`joinSessions`:**
  - **Which sessions count:** a session belongs to the repository when its `cwd`, or a file it loaded, is inside one of `roots`.
  - **Which files count:** only files inside a root. A file is inside when `path.relative(root, file)` does not climb out. With `/` separators, that relative path is the key into `unitsByPath`.
  - **Skill calls** match the skills listed in the top-level Claude Code context (`site === ''`) by name, as `joinLoads` does.
  - **The AGENTS.md fallback:** each session gets `fallbackLoads` for the units it did not observe. Units seen only that way are `predicted`.
  - **Other versions:** for a one-file unit, a load whose `sha256` differs from the scanned file's counts in `otherVersion`.
  - **`unseen`** lists the top-level Claude Code context's entries that no session loaded. It is empty when `sessions` is 0.
  - **`errors`** and `skipped` count every line, whatever the repository.

- [ ] **Step 1: Write the failing test** for the bug found while planning, in `tests/eval/loads.test.ts`: `keeps the digest when the run copy has CRLF line endings`.
  - The scan is of LF files, and the copy has CRLF.
  - Today `digestIn` hashes the raw bytes, so the digest comes out `null`.
- [ ] **Step 2: Run** `npx vitest run tests/eval/loads.test.ts`. Expected: FAIL (`null`).
- [ ] **Step 3: Fix** `digestIn` to hash with `lfDigest`. Then extract `unitsByPath`, `loadReason` and `fallbackLoads` from `joinLoads`, which keeps its behaviour.
- [ ] **Step 4: Run** the same command. Expected: PASS. **Commit** `fix: eval reads a loaded file's CRLF as LF, as scans do`.
- [ ] **Step 5: Write the failing tests:**
  - **`tests/collect/events.test.ts`:**
    - `reads every month's file, and skips lines it cannot read`: a line cut short, a `v: 2` line and an unknown event give `skipped: 3`, and the rest are read (Review Focus 1);
    - `no events folder gives no events`;
    - `eventsHome is CTXLOCK_HOME, else .ctxlock in the home folder`.
  - **`tests/collect/sessions.test.ts`.** The scans are `memReader` repositories. The events are built in the test, with roots from `resolve()`, so the paths are native.
    - `counts each unit once per session, with its reasons and its last load`;
    - `matches a skill call to the skill Claude Code lists, by name; an unknown name is ignored`;
    - `leaves out files outside the repository, but counts a session started in a subfolder` (Review Focus 2);
    - `matches paths whatever their separators or drive-letter case`. This one runs on Windows only, with `it.runIf(process.platform === 'win32')` (Review Focus 3);
    - `counts a load of an edited file as another version of the unit` (Review Focus 4);
    - `labels AGENTS.md read through the fallback as predicted, in every session`;
    - `lists what Claude Code can load that no session loaded, with its mode, and nothing before any session`;
    - `counts collector errors and unread lines, whatever the repository`;
    - `says when no consumer covers the sessions`: `undeclared` is true with no consumers, and false with a consumer whose harnesses include `claude-code`.
- [ ] **Step 6: Run** `npx vitest run tests/collect`. Expected: FAIL, because the modules don't exist.
- [ ] **Step 7: Implement** `src/collect/events.ts` and `src/collect/sessions.ts`.
- [ ] **Step 8: Run** `npx vitest run tests/collect tests/eval/loads.test.ts`. Expected: PASS. **Commit** `feat: join recorded sessions to units`.

### Task 3: `ctxlock loads`, and observed sessions in `who-uses`

**Files:**
- Create: `src/report/loads.ts`, `tests/report/loads.test.ts`
- Modify: `src/graph/graph.ts`, `src/report/graph.ts`, `tests/report/graph.test.ts`, `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`

**Interfaces:**
- Consumes: `eventsHome`, `readEvents`, `joinSessions`, `Sessions`, `UnitLoads` (Task 2).
- Produces:
  ```ts
  export function renderLoads(s: Sessions, format: 'text' | 'json'): string;
  // WhoUses gains:
  observed?: { sessions: number; unit: UnitLoads | null };
  ```
  - **`ctxlock loads [dir] [--format text|json]`:**
    - It scans the working tree with `fsReader(root)`.
    - It joins `readEvents(eventsHome())` with roots `[realpathSync.native(root), root]`, without duplicates. The first is real by the lesson of M5; the second is as the user typed it.
    - A `dir` that isn't a directory exits 2.
  - **`who-uses`** runs the same join, and sets `observed` when `sessions > 0`.
  - **Text** (empty sections left out, as in `renderBuild`):
    ```
    ctxlock loads · 20 Claude Code sessions, 2026-10-30 to 2026-11-08

    Loaded:
      CLAUDE.md                20 sessions  session_start              last 2026-11-08
      AGENTS.md                20 sessions  import                     last 2026-11-08
      .claude/rules/api.md      5 sessions  glob                       last 2026-11-07  2 on another version

    Not loaded in these sessions:
      .claude/rules/legacy.md  lazy
      .claude/skills/old       listed

    These sessions match no consumer in ctxlock.yaml. Declare one so impact can name it.

    Collector errors: 2. The last: <message>
    Lines not read: 1
    ```
  - **A unit seen only through the `AGENTS.md` fallback** shows its reason as `session_start (predicted)`.
  - **With no session**, the header is `ctxlock loads · no Claude Code sessions recorded for this repository`, followed by the two install commands from D63 (Review Focus 5).
  - **`who-uses`** adds a section after `Loaded by (predicted)`. When the unit is `null`, the line is `claude-code  0 of 20 sessions`.
    ```
    Loaded in sessions (observed):
      claude-code  14 of 20 sessions  last 2026-11-08  session_start
    ```
  - JSON is the object itself.

- [ ] **Step 1: Write the failing tests:**
  - **Renderer tests:**
    - each section;
    - empty sections left out;
    - `(predicted)` and `on another version` only when they apply;
    - the install note when there are no sessions;
    - JSON equal to the input.
  - **`who-uses` renderer tests:** the observed section; `0 of N`; no section without `observed`.
  - **CLI tests,** with `vi.stubEnv('CTXLOCK_HOME', <temp>)` holding events for a temporary repository:
    - `loads` lists the units;
    - `who-uses` shows the observed line;
    - an empty home gives the install note, exit 0, and `who-uses` without the section (Review Focus 5);
    - a `dir` that isn't a directory exits 2.
- [ ] **Step 2: Run** `npx vitest run tests/report/loads.test.ts tests/report/graph.test.ts tests/cli.test.ts -t "loads|who-uses"`. Expected: FAIL.
- [ ] **Step 3: Implement** `renderLoads`, the observed section, and the command.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Document** `ctxlock loads` in `the-guide/commands.md`, with its exit codes, and the observed section under `who-uses`.
- [ ] **Step 6: Commit** `feat: ctxlock loads, and observed sessions in who-uses`.

### Task 4: The live check, docs and decisions

**Files:**
- Create: `the-guide/collector.md`, `docs/dogfood/2026-11-08-collector.md`, `journey/12-collector.md`
- Modify: `the-guide/README.md`, `the-guide/graph.md`, `README.md`, `journey/README.md`, `journey/decisions.md`, `journey/mistakes.md` if anything broke, and this plan's progress table

- [ ] **Step 1: The exit criterion: observed edges match `InstructionsLoaded`.**
  - **The fixture:** build S4's fixture again under `F:/ctxlock-live/collector/`, plus a repository with only an `AGENTS.md`.
  - **The sessions:** S4's three prompts (api, web, release) and one in the `AGENTS.md` repository. Each runs `claude -p --model sonnet` with `--plugin-dir F:/ContextFS/plugin`, and S5's dump plugin as a second `--plugin-dir`, with `CTXLOCK_HOME=F:/ctxlock-live/collector/home`.
  - **The comparison:** the dump's in-repository `InstructionsLoaded` and Skill events against `ctxlock loads --format json`.

  Expected:
  - the same units, sessions and reasons;
  - `AGENTS.md` labelled predicted;
  - `packages/web/AGENTS.md` not loaded (`L13`);
  - nothing from outside the repository.
- [ ] **Step 2: One real repository.** Run one session in `F:/ctxlock-live/repos/plano`, which has a `CLAUDE.md` and `.claude/skills`, with the collector, then `ctxlock loads` and `ctxlock who-uses` on a unit it loaded. Record any surprise as a finding, with its test, before the docs.
- [ ] **Step 3: Write the docs:**
  - **`the-guide/collector.md`:**
    - how to install the collector, disable it and remove it;
    - the exact fields it records, and what it never records;
    - where the events live, and how to delete them;
    - what it can't see: the `AGENTS.md` fallback, the model, and other agents.
  - **`the-guide/graph.md`:** observed loads beside the predicted ones.
  - **The dogfood report.**
  - **`journey/12-collector.md`** and the journey index.
  - **D63–D67** in `journey/decisions.md`.
  - **The README:** the roadmap line.
- [ ] **Step 4: Commit** `docs: the collector, live; journey chapter 12, decisions D63–D67`.

## After this plan

- A fresh review of the whole plan's range, then the finishing steps, as in Plans 2–4.
- Next in Phase 2: the org context repository, with `ctxlock sync`, `ctxlock.lock` and `ctxlock report` (D67).
