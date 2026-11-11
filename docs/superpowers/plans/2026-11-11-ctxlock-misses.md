# ctxlock misses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which context units were in play when a person had to stop or correct their agent, and draft a note to each unit's owner once a unit has been involved in several sessions.
- **Signals** come from Claude Code's own transcripts: a person interrupting the agent, or a prompt that corrects it ("no, …", "I meant …").
- **`ctxlock misses`** joins each signal to the units the collector saw load in that turn, and counts, per unit, the distinct sessions it was involved in.
- **`misses --drafts`** writes one draft per unit that passes the threshold, addressed to its owner. A synced unit's draft is addressed to the repository it came from. The person's own words go in only with `--excerpts`, redacted.

**Architecture:**
- **Read in place, store nothing.** Transcripts stay where Claude Code keeps them (`~/.claude/projects/*/<session>.jsonl`). `misses` streams them for the sessions the collector recorded in this repository, and keeps what it derives only in memory. The only files it writes are drafts, and only into the folder `--drafts` names.
- **Exposure is the collector's.** Which units loaded, and when, comes from the collector's events (Plan 5), which come from documented hooks. The transcript's own record of attachments is undocumented, so it is not used.
- **Attribution here is exposure only**, the first of the spec's three tiers. Diagnosis by a model and replay are Plan 8.

**Tech Stack:** as in Plans 1–6: TypeScript 7 on Node ≥ 22 (ESM), commander, zod, vitest. **No new runtime dependency.**

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- §2, principle 3: signals of misses, clustering, tiered attribution, routing to the owner;
- §4.3: `context.outcome` with signal `user_correction`, and events that carry IDs and digests, never content, unless the user opts in;
- §6 Phase 3: signals from transcripts; clustering with a threshold of several distinct sessions; tier 1, exposure statistics per unit version; routing to the owner; sessions that took in untrusted content scored down;
- §7 Phase 3: rate limits per source; PII and secret redaction before any trace text leaves the machine.

Satyam asked on 2026-11-11 to "start the work, move to next part" without design questions. Every call below that the spec leaves open is marked as mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | 4bc1996 |
| 2 | Done | 23ecef6 |
| 3 | Done | b9b9e6f |
| 4 | Done | b1829ff |
| 5 | Done | f34e462 |
| 6 | Done | db10ae3 (fix), 7ac841f (fix), 29ccc79; final review fixes c3f6f4e, b5d50b7 |

## What was checked before writing this plan

These were checked on Satyam's own transcripts on 2026-11-11: 1,038 files, across `F:\ContextFS`, `E:\snag`, `E:\ElevenPowers` and eval runs.

- **A person's typed prompt** is a `type: "user"` line with `origin.kind: "human"`, or `turnOrigin: "human"` in older versions. It is not `isMeta` and not `isSidechain`. Some lines are not typed by the person, and they carry other marks:
  - `claude -p` prompts: `promptSource: "sdk"` and `turnOrigin: "sdk"`;
  - task notifications;
  - command output;
  - hook text.
- **Compaction summaries are the exception.** They also carry `origin.kind: "human"`, start with "This session is being continued from a previous conversation", and quote earlier prompts.
- **An interrupt** is a user line whose text block is exactly `[Request interrupted by user]`. There are 9 in the data.
- **A rejected tool use: none in the data.** Satyam runs in auto mode. The one hit for Claude Code's rejection text was this session's own `grep` command, quoted in a tool result. So a detector must match the structure of a line, never a substring.
- **The phrase list below** matched 12 of 694 prompts that followed an assistant turn. After two exclusions, compaction summaries and pasted text, it matched 5 of 676, and all 5 are genuine corrections. How many corrections the list misses is unknown.
- **Transcripts reach 157 MB**, so they are streamed line by line.
- **The collector is installed.** `~/.ctxlock/events` has sessions with load events in all three repositories.

## Rulings this plan makes (my calls)

Each also goes into `journey/decisions.md` in Task 6.

- **D77. Phase 3 is three plans.**
  - This plan covers misses: signals, exposure and drafts.
  - Plan 8: diagnosis, counterfactual replay, and fix proposals in the `proposal` tier validated by replay, then opening issues.
  - Plan 9: durability at 7 and 30 days, the counters, and the compounding metrics.
  - **This plan opens nothing on GitHub.** An owner should first be sent a diagnosed miss, not raw signals: owner fatigue is open problem 8 in research/05.
  - *If wrong:* `--open` moves into this plan; it is one `gh` call per draft.
- **D78. Two signals, each checked against real transcripts: `interrupted` and `correction`.**
  - **Rejected tool uses wait** for a real rejection to check the format against.
  - **Thumbs** leave no record in the transcript.
  - **"Relevant skill not loaded" and empty tool results** need Plan 8's diagnosis to mean anything.
  - **A skill typed as `/name`** is how Satyam starts work, not a miss.
  - *If wrong:* each is one more detector in `readTranscript`.
- **D79. A correction is a person's prompt, after the agent has answered at least once, whose opening matches a short phrase list.** The opening is the first 160 characters, with `<pasted_content …>…</pasted_content …>` blocks removed. The list:
  ```ts
  export const CORRECTION = [
    /^(no|nope|nah|wrong|stop|undo|revert)\b/i,
    /^(that'?s|this is|it'?s|thats) (not|wrong)\b/i,
    /^actually\b/i,
    /\b(i meant|i said|i asked( you)?|i told you|not what i|you (forgot|missed|ignored|skipped)|why did you|why are you|you should(n'?t| not)? have|don'?t do that)\b/i,
  ];
  ```
  - Compaction summaries never count.
  - No model is used. It would send prompt text away, and cost runs, for every session.
  - *If wrong:* Plan 8's diagnosis can re-read candidates with a model, on request.
- **D80. A signal's candidates are the units loaded in its turn.**
  - **A turn** runs from the person's prompt before the signal up to the signal. Loads before the session's first prompt belong to the first turn.
  - **A unit loaded in every session** is reported but marked: exposure alone can't single it out.
  - *If wrong:* a window measured in minutes instead of turns.
- **D81. A unit is routed when signals reach it in at least 3 distinct sessions (`--min-sessions`).**
  - A session counts once however many signals it has: that is §7's rate limit per source.
  - A session that used `WebFetch`, `WebSearch` or an MCP tool before its signal counts half, as §6 asks for sessions that took in untrusted content.
  - *If wrong:* the default is one flag away.
- **D82. A draft goes to the unit's owner, in the repository that owns the unit.**
  - For a synced unit, that is the upstream `ctxlock.lock` names. Owners come from `unitOwners`.
  - A draft holds counts, dates and digests.
  - With `--excerpts`, it also holds the opening of each correction, redacted and fenced, so no `@` in it mentions anyone.
  - Interrupts have no words.
  - *If wrong:* more fields, on request.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- **Nothing is stored.** `misses` writes only drafts, only into the `--drafts` folder, and never over a file there that does not start with its marker line.
- **No content leaves the machine.** `misses` makes no network call and runs no agent.
- **Content is opt-in.** Without `--excerpts`, no output (text, JSON or draft) holds a person's words.
- **Folder paths are compared through a real-path function**, as `joinSessions` and `pinnedBy` do. Windows CI's temp folder has an 8.3 name, and a session can record `f:\` for `F:\`.
- **Exit codes:**
  - **0:** done, including when there are no sessions;
  - **2:** cannot run, for example a directory that isn't one, or a bad `--since`.
- **Code style:** `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test.

## Review Focus

1. **Text that only quotes a marker:** a tool result containing `[Request interrupted by user]` or a phrase from the list, a correction phrase inside pasted text, and a compaction summary quoting "I meant" are not signals (Task 1).
2. **A transcript still being written:** its last line is cut short. That line is skipped, and the rest is read (Task 1).
3. **A session recorded in another form of the path:** started in a subfolder, through a junction or an 8.3 name, or with `f:\` for `F:\`, it is joined to the repository's units (Tasks 2 and 3).
4. **An excerpt carrying a token, an email, a local path, a URL with credentials, or an `@mention` and markdown:** it is redacted and fenced in the draft, and pings no one (Task 5).
5. **A recorded session whose transcript is gone, or a transcript with no load events:** it is counted as such, and never attributed or crashed on (Tasks 3 and 4).

## Files

| File | Responsibility |
|---|---|
| `src/loop/transcript.ts` | `findTranscript`, `readTranscript`: a session's prompts and signals |
| `src/collect/sessions.ts` | `sessionTimelines`, the per-session part of `joinSessions`, exported |
| `src/loop/misses.ts` | `findMisses`: signals joined to the units in their turn, per-unit counts, the threshold |
| `src/report/misses.ts` | `renderMisses` (text, json) |
| `src/loop/redact.ts` | `redact` |
| `src/loop/draft.ts` | `renderDraft`, `draftName` |
| `src/cli.ts` | `ctxlock misses` |

---

### Task 1: Signals from a transcript

**Files:** Create `src/loop/transcript.ts`, `tests/loop/transcript.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type SignalKind = 'interrupted' | 'correction';
  export interface Signal { kind: SignalKind; ts: string; untrusted: boolean; words?: string }   // words: a correction's opening
  export interface SessionTranscript { session: string; prompts: string[]; signals: Signal[] }   // prompts: each typed prompt's ts, ascending
  export const CORRECTION: RegExp[];                                                              // D79's list, verbatim
  export const transcriptsHome = (env: NodeJS.ProcessEnv = process.env) => string;                // join(env.CLAUDE_CONFIG_DIR || ~/.claude, 'projects')
  export function findTranscript(home: string, session: string): string | null;                  // <home>/*/<session>.jsonl
  export async function readTranscript(file: string, session: string): Promise<SessionTranscript>;
  ```
- **Reading:**
  - Stream with `readline` over `createReadStream`.
  - Parse only lines that contain `"type":"user"` or `"type":"assistant"`. Skip a line that doesn't parse, and every `isSidechain: true` line.
- **The rules:**
  - **Untrusted content:** an assistant `tool_use` block named `WebFetch` or `WebSearch`, or starting `mcp__`, makes every later signal `untrusted`.
  - **An interrupt:** a user line with a text block, or string content, matching exactly `/^\[Request interrupted by user( for tool use)?\]$/`. Any origin.
  - **A typed prompt:** a person's prompt as defined under "What was checked". Each adds its `ts` to `prompts`.
  - **A correction:** a typed prompt after at least one assistant line, not starting with "This session is being continued from a previous conversation", whose opening matches `CORRECTION`. `words` is that opening.

- [ ] **Step 1: Write the failing tests.** Fixtures are JSONL built in the test, in the shapes above:
  - `finds an interrupt and a correction, each with its time, and the typed prompts' times`;
  - `a marker or a phrase quoted in a tool result, pasted text or a compaction summary is no signal` (Review Focus 1);
  - `a prompt before the agent's first answer, a claude -p prompt, a meta line and a sidechain line are no correction`;
  - `a signal after WebFetch, WebSearch or an MCP tool is untrusted, and one before is not`;
  - `a last line cut short is skipped and the rest is read` (Review Focus 2);
  - `findTranscript finds a session's file under any project folder, under CLAUDE_CONFIG_DIR, and gives null when there is none`;
  - `CORRECTION matches "no, use pnpm", "I meant the other file" and "actually, leave it", and not "now add tests", "nothing else" or "I'd actually like…"`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/transcript.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: read interrupts and corrections from a Claude Code transcript`.

### Task 2: Per-session load timelines

**Files:** Modify `src/collect/sessions.ts`, `tests/collect/sessions.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface SessionLoad { unit: Unit; ts: string; reason: string; other: boolean; observed: boolean }   // today's private Load
  export interface Timeline { session: string; folder: string; begun: string; last: string; loads: SessionLoad[] }
  export function sessionTimelines(read: { events: RecordedEvent[]; skipped: number }, scan: ScanResult, roots: string[], real?: (path: string) => string): Timeline[];
  ```
- Move the per-session part of `joinSessions` into `sessionTimelines`: grouping by session, the folder and site, the loads, and the fallback loads. `joinSessions` then tallies from it.
- `joinSessions`'s output does not change, so every existing test in `tests/collect/sessions.test.ts` passes unedited.

- [ ] **Step 1: Write the failing test:** `sessionTimelines gives each session in the repository its folder, first and last times, and its loads in time order, including predicted fallback loads; a session elsewhere is left out`.
- [ ] **Step 2: Run** `npx vitest run tests/collect`. Expected: the new test FAILS, and the rest pass.
- [ ] **Step 3: Implement** the move.
- [ ] **Step 4: Run** `npx vitest run tests/collect tests/cli.test.ts`. Expected: PASS. **Commit** `refactor: per-session load timelines out of joinSessions`.

### Task 3: Joining signals to units

**Files:** Create `src/loop/misses.ts`, `tests/loop/misses.test.ts`.

**Interfaces:**
- Consumes: `Timeline` (Task 2), `SessionTranscript` (Task 1), `ScanResult` (its `codeowners`, `registry` and `lock`), and `unitOwners`.
- Produces:
  ```ts
  export interface MissSignal { session: string; kind: SignalKind; ts: string; untrusted: boolean; words?: string; turn: string[] }   // unit ids
  export interface UnitMiss {
    id: string; path: string; owners: string[];
    upstream: { name: string; repo: string } | null;   // from ctxlock.lock, for a synced unit
    sessions: number;                                  // weighted: a session counts 1, or 0.5 when all its signals here are untrusted
    loadedIn: number; everySession: boolean;
    olderVersion: number;                              // routed-signal sessions whose load had bytes other than today's

    kinds: Record<SignalKind, number>;                 // signals, not sessions
    first: string; last: string; routed: boolean;
    signals: MissSignal[];
  }
  export interface Misses {
    sessions: number; withTranscript: number; withSignal: number;
    signals: Record<SignalKind, number>; untrusted: number;
    unattributed: number;                              // signals whose turn loaded no unit
    since: string | null; minSessions: number;
    units: UnitMiss[];                                 // involved units: by sessions, then path
  }
  export function findMisses(timelines: Timeline[], transcripts: Map<string, SessionTranscript>, scan: ScanResult, opts: { minSessions: number; since?: string }): Misses;
  ```
- **The rules:**
  - **A signal's turn** is D80's.
  - **`routed`** is `sessions >= minSessions`.
  - **`since`** keeps only sessions begun on or after it.
  - **A timeline with no transcript** counts in `sessions` but not in `withTranscript`.

- [ ] **Step 1: Write the failing tests:**
  - `a correction is joined to the rule that loaded in its turn, not to one from an earlier turn`;
  - `loads before the first prompt belong to the first turn`;
  - `a unit reached in three sessions is routed, and in two it is not; two signals in one session count once`;
  - `a session whose signals came after a web or MCP tool counts half`;
  - `a unit loaded in every session is marked everySession, and a session that loaded other bytes counts in olderVersion`;
  - `a synced unit names its upstream from the lock, and owners come from ctxlock.yaml or CODEOWNERS`;
  - `a session with no transcript, and a signal whose turn loaded nothing, are counted and attributed to no unit` (Review Focus 5);
  - `since leaves out sessions begun before it`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/misses.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: join interrupts and corrections to the units in their turn`.

### Task 4: `ctxlock misses`

**Files:** Create `src/report/misses.ts`, `tests/report/misses.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`.

**Interfaces:**
- Consumes: Tasks 1–3, `readEvents`, `eventsHome`, `sessionTimelines` with `sessionsAt`'s roots and real-path cache.
- Produces:
  ```ts
  export function renderMisses(m: Misses, format: 'text' | 'json', excerpts: boolean): string;
  ```
- **The command:** `ctxlock misses [dir] [--format text|json] [--since <YYYY-MM-DD>] [--min-sessions <n>] [--excerpts] [--drafts <folder>]`. `--drafts` arrives in Task 5. `--min-sessions` defaults to 3 and goes through `count`. A `--since` that isn't a date is exit 2.
- **The text shape:**
  ```
  ctxlock misses · 9 sessions, 7 with a transcript · 2026-11-08 → 2026-11-11

  Signals: 1 interrupted · 2 corrections, in 3 sessions

  Units in the turn when the agent was stopped or corrected:
    rule/.claude/rules/testing.md  3 sessions  loaded in 5  owner @platform  routed
    skill/.claude/skills/release   1 session   loaded in 2  from platform

  In every session, so exposure can't single them out:
    instructions/CLAUDE.md  2 sessions

  No load in the turn: 1 signal
  Routed at 3 sessions or more: 1 unit. Write drafts with --drafts <folder>.
  ```
  - With no recorded sessions, the output is one line: `No sessions recorded in <dir>. The collector records them: the-guide/collector.md`.
  - JSON is the `Misses` object. Without `--excerpts`, every `words` is dropped.

- [ ] **Step 1: Write the failing tests:**
  - **Renderer:**
    - `text lists units by sessions, marks routed and everySession, and names an upstream`;
    - `json and text hold no words without --excerpts, and do with it`.
  - **CLI**, with a temp `CTXLOCK_HOME` and `CLAUDE_CONFIG_DIR`:
    - `misses joins a recorded session's transcript to the repository's units`;
    - `a session recorded with a lowercase drive or through a junction is joined` (Review Focus 3; the junction is made the way the `pinnedBy` fix's test makes it);
    - `no recorded sessions is exit 0 with the collector pointer`;
    - `a bad --since is exit 2`.
- [ ] **Step 2: Run** `npx vitest run tests/report/misses.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and add `ctxlock misses` to `the-guide/commands.md`.
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: ctxlock misses lists the units in play when the agent was stopped or corrected`.

### Task 5: Drafts for owners, and redaction

**Files:** Create `src/loop/redact.ts`, `src/loop/draft.ts`, `tests/loop/redact.test.ts`, `tests/loop/draft.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`.

**Interfaces:**
- Consumes: `UnitMiss` (Task 3).
- Produces:
  ```ts
  export function redact(text: string): string;
  export const DRAFT_MARK = (id: string) => `<!-- ctxlock:miss ${id} -->`;
  export function draftName(id: string): string;   // id with every character outside [A-Za-z0-9._-] as '-', plus '.md'
  export function renderDraft(m: UnitMiss, repo: string, excerpts: boolean): string;   // repo: this repository's shareable name, or the upstream's repo
  ```
- **What `redact` replaces:**
  - **Tokens, by the prefixes [gitleaks](https://github.com/gitleaks/gitleaks) (MIT) uses:** `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` and `github_pat_`; `sk-ant-` and `sk-`; `xox[abprs]-`; `AKIA` plus 16 characters; three-part `eyJ` JWTs; and `-----BEGIN … PRIVATE KEY-----` blocks. Each becomes `<token>`.
  - **Emails** become `<email>`.
  - **A URL** loses its user, password, query and fragment.
  - **An absolute path** (`C:\…`, `/home/…`, `/Users/…`) keeps its last segment, as `<path>/name`.
  - **Any other run of 32 or more of `[A-Za-z0-9+/=_-]`** becomes `<redacted>`.
- **The draft:**
  - **First line:** `DRAFT_MARK`.
  - **Heading:** `ctxlock: <id> was in play when the agent was stopped or corrected`.
  - **The facts:**
    - the repository it belongs in, and its owners;
    - sessions (weighted, with untrusted noted), signals by kind, and first and last dates;
    - the unit's digest today, and how many of those sessions loaded other bytes (`olderVersion`);
    - the `everySession` caveat when it applies.
  - **The excerpts, with `--excerpts`:** each correction's `redact`ed words, in a fence one backtick longer than the longest run inside it.
  - **A closing line:** these are signals, not a diagnosis.
- **The CLI:**
  - `--drafts <folder>` writes `draftName` for each routed unit, creating the folder.
  - A file there that doesn't start with its `DRAFT_MARK` is left alone and listed under "Left as it is".
  - It prints the files it wrote.

- [ ] **Step 1: Write the failing tests:**
  - **Redaction:**
    - `redact replaces each token shape, an email, a URL's credentials and query, and a home path, and leaves ordinary words and short hex alone` (Review Focus 4).
  - **The draft:**
    - `a draft names the unit's owners and repository, counts sessions and signals, and holds no words without excerpts`;
    - `with excerpts, an @mention, a backtick run and a markdown link stay inside a fence that outlasts them`;
    - `a synced unit's draft names the upstream's repository`.
  - **The CLI:**
    - `--drafts writes one file per routed unit, rewrites its own drafts, and leaves a person's file of the same name`.
- [ ] **Step 2: Run** `npx vitest run tests/loop tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: misses --drafts writes a note to each routed unit's owner, redacted`.

### Task 6: The live run, docs and decisions

**Files:** Create `docs/dogfood/2026-11-11-misses.md`, `the-guide/misses.md`, `journey/14-misses.md`. Modify `the-guide/README.md`, `README.md`, `journey/README.md`, `journey/decisions.md`, this plan's progress table.

- [ ] **Step 1: The live run, on Satyam's real sessions.** Run `ctxlock misses --format json --excerpts` on `F:\ContextFS`, `E:\snag` and `E:\ElevenPowers`. Read-only: nothing is written into those repositories.
  - **The check:** a scratchpad script scans the same sessions' transcripts on its own, using the rules under "What was checked". It must find the same interrupts and corrections, with the same times.
  - **Report:**
    - each signal's turn units, checked by hand against the collector's events for a sample;
    - which units pass the threshold;
    - one `--drafts` run into a scratchpad folder.
  - **What the report never quotes:** a person's words, beyond what Satyam's own prompts in this repository already show in `journey/`.
- [ ] **Step 2: Docs.**
  - **`the-guide/misses.md`:**
    - what a signal is and why;
    - what is read, and that nothing is stored;
    - the threshold and the untrusted half;
    - drafts, and what `--excerpts` adds;
    - what it doesn't do yet (Plan 8).
  - **README:** one item in "What it can do today", and a partly ticked roadmap line for the feedback loop.
  - **`journey/14-misses.md`.**
  - **`journey/decisions.md`:** D77–D82.
- [ ] **Step 3: Run** `npm run ci`. Expected: PASS. **Commit** `docs: ctxlock misses in the guide, the live run, and D77-D82`, push, and watch both operating systems' CI.

## Deferred minors (final review)

All 11 were fixed on 2026-11-11 at Satyam's request, one commit each (54fad57..fb0af3b): 1 4c64b43, 2 d2e87b2, 3 44993a2, 4 be8dcd5, 5 c28860b, 6 2793caf, 7 802b5ff, 8 3072f21, 9 fb0af3b, 10 54fad57, 11 8daf158.

As found:
1. "N after web or MCP content, counted at half" counts signals, while the half weight applies to a session only when every signal in it is untrusted.
2. Two unit IDs that map to one `draftName` keep one draft, and the second is listed as "not a ctxlock draft".
3. A correction with line breaks breaks the indentation of the text output's "Corrections" block.
4. `--since 2026-13-01` prints "Invalid time value" instead of the usage message. The exit code, 2, is right.
5. `--since` compares UTC dates.
6. Untrusted content read by a subagent never halves the session.
7. Units loaded before a compaction still count as in context after it.
8. Signals joined to no unit have no times or words in the JSON.
9. A synced unit's draft lists this repository's owners next to the upstream it belongs in.
10. The per-session trust map is computed in both `misses.ts` and `draft.ts`, and `plural` now has a third copy.
11. The JSON repeats every signal, with its context, under every unit in that context.

## After this plan

Plan 8 takes the routed units:
- **Diagnosis:** a model diagnoses each one with Ada's taxonomy (defect, gap, preference, agent error), on request.
- **Replay:** the session is replayed with the unit ablated or edited.
- **A proposed fix:** the smallest fix, as a `proposal`-tier draft pull request, validated by replaying the surfacing sessions plus the consumer's probes.
- **Issues:** `--open`, once a miss is diagnosed.
