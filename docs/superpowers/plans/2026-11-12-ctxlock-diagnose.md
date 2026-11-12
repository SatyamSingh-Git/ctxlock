# ctxlock diagnose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a unit that `ctxlock misses` routed into a diagnosed, tested proposal for its owner.
- **`ctxlock diagnose <unit>`** asks Claude, through the person's own `claude` CLI, what went wrong in the moments the unit was in context: a defect in the unit, a gap in it, the person's preference, or the agent's own error.
- **For a defect or a gap,** the same reply carries:
  - the smallest fix to the unit's text;
  - a probe made from the person's correction.
- **The proposal is checked by replay.** The fix and the probe run in throwaway copies, through eval's own runner:
  - the probe must fail with the unit as it is and pass with the fix;
  - none of the unit's existing probes may get worse.
- **`--open`** files the result as one GitHub issue for the unit's owner, in the repository that owns it.

**Architecture:**
- **Diagnosis is one run of Claude Code with no tools,** as `probe draft`'s drafting run is.
- **Replay reuses eval's paired runner.** It is moved out of `runEval` so it can take two readers: the repository as it is, and an `overlayReader` with the fix applied.
- **ctxlock never writes the fix into the repository** (D50; §3's anti-goal "auto-generating context and shipping it"). The proposal is a file in the drafts folder, and an issue only on request.

**Tech Stack:** as in Plans 1–7: TypeScript 7 on Node ≥ 22 (ESM), commander, zod, yaml, vitest; `claude` and, for `--open`, `gh` on the `PATH`. **No new runtime dependency.**

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- **§6 Phase 3:**
  - tiered attribution, tier 2: "An LLM diagnosis using Ada's taxonomy: defect, gap, preference, or agent error";
  - tier 3: counterfactual replay that edits the top candidate unit;
  - routing: "a GitHub issue to the owner, or a draft PR with the smallest fix, carrying the source trace(s) as provenance";
  - "Proposals live in the proposal tier and are never auto-merged";
  - validation: "Replay the surfacing traces plus the consumer's golden set. The PR must improve the cluster with no regressions elsewhere".
- **§5.2,** task sources: "Phase 3: failing traces turned into regression cases".
- **§7 Phase 3:**
  - proposal quarantine with trace provenance;
  - redaction before trace text is stored;
  - "Agents can never set `ctxlock.tier` or write `certified` units".
- **§3,** the anti-goals: no auto-generated context shipped, no auto-merge.

Satyam asked on 2026-11-12 to "continue the work" without design questions. Every call below that the spec leaves open is marked as mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `0186267` |
| 2 | Done | `067b857` |
| 3 | Done | `3487c6a` |
| 4 | Done | `04630ce` |
| 5 | Done | `8f13ada` |
| 6 | Done | the docs commit |

## Rulings this plan makes (my calls)

Each also goes into `journey/decisions.md` in Task 6.

- **D83. Diagnosis is opt-in, per unit, and sends only what it needs, redacted.** `ctxlock diagnose <unit>` sends to Claude, through the person's own `claude` CLI:
  - the unit's text;
  - for each signal in context, the opening of the prompt that began its turn;
  - the agent's actions in that turn: each tool's name, with its command, path or pattern;
  - the person's correction.

  Everything after the unit's text goes through `redact` first. The diagnosing run has no tools.
  - *If wrong:* a `--no-actions` flag, or a smaller set.
- **D84. The verdicts are `defect`, `gap`, `preference`, `agent-error` and `unclear`:** Ada's taxonomy as the spec names it, plus a way to say the evidence is too thin.
  - A fix and a probe are asked for only on `defect` or `gap`.
  - Only a correction says what was wanted, so a unit with interrupts alone gets a verdict and no fix.
  - *If wrong:* more verdicts, by request.
- **D85. The smallest fix is one exact replacement in the unit's text: `find`, which must occur exactly once, and `replace`.**
  - **Why one replacement:** research/05 favours the smallest justified edit (SkillsVote) and deltas over rewrites (ACE, context collapse).
  - **What it may edit:** only an instructions or rule file, or a skill's `SKILL.md`.
  - **A certified unit** is diagnosed and its fix proposed, but the proposal says it needs its owner's approval (§7).
  - *If wrong:* several replacements per proposal.
- **D86. A proposal is validated by replay, and ctxlock never writes it into the repository.**
  - **Where it runs:** throwaway copies, one of the repository as it is and one with the fix applied.
  - **Which probes run:** the miss's probe, and every probe already on that unit, the same number of runs on each side.
  - **"validated" means:** the miss's probe is `improved` (eval's status), and no other probe `regressed`.
  - **"not validated" and "inconclusive"** are reported as they are.
  - *If wrong:* a `--write` that applies a validated fix in the working tree.
- **D87. `--open` files or updates one issue per unit,** through the person's own `gh`, in the repository the unit belongs to: this one's `origin`, or the upstream's repository for a synced unit.
  - It only files for a diagnosed `defect` or `gap`.
  - **What the issue holds:** the diagnosis, the fix, the probe, whose prompt is redacted, and the replay. It never holds the session's own text (the task, the actions, the correction). It goes on the owner's tracker, and `--excerpts` stays local, as D82 has it.
  - A marker in the body finds the issue on the next run, and that issue is updated.
  - No pull request is opened: the fix needs its owner's reading first (§6, "never auto-merged").
  - *If wrong:* a draft pull request carrying the validated fix, later.
- **D88. The live run uses a planted miss.**
  - Plan 7 already checked signal detection on real sessions. None of the author's real corrections is joined to a unit, and `claude -p` prompts never count as typed.
  - So a fixture repository gets a session written in Claude Code's own shape, and the diagnosis and the replay then run on real Claude Code.
  - *If wrong:* none; the same command runs on real sessions.

## Global Constraints

- Node ≥ 22, TypeScript 7, ESM. No new runtime dependency.
- **Only `diagnose` sends text away, and only what D83 lists, redacted.** `misses` still sends nothing.
- **Nothing is written into the repository.** Proposals go to the `--drafts` folder, under the rules `misses --drafts` already has: a marker with a digest, so an edited file stays. Run folders go under `--workdir`.
- **Replay runs exactly as eval's runs do:**
  - hooks observe and deny every action;
  - the copy's hooks and settings are stripped;
  - a run that changes a file stops everything.
- **The model's reply is data.**
  - **Before it is used:** its JSON is checked with zod, every quote must occur in the unit's text, `find` must occur exactly once, and the probe must pass `parseProbeFile`.
  - **When it is printed:** control characters are replaced, as `probe draft` does.
- **Exit codes:**
  - **0:** done, whatever the verdict.
  - **2:** cannot run, such as an unknown unit, a unit with no signal in context, Claude Code not found, a reply that fails its checks, or `gh` failing.
- **Code style:** `~/.claude/code-style.md`. Tests in both directions, and a mutation check on every test. Mutants are built from the file's own lines, never inside a shell string.

## Review Focus

1. **A reply that is not what was asked:** no JSON; a verdict outside the list; a quote, or a `find`, that is not in the unit or occurs twice; a probe whose `expect` doesn't parse. Each is exit 2, naming what failed, with nothing written (Task 2).
2. **Text from the session that reaches Claude:** a token, a path, an email or a URL with credentials in the task prompt, an action or the correction, all redacted before sending (Task 1 and Task 2).
3. **A fix that changes nothing an agent does, or makes another probe worse:** reported as not validated, and its proposal says so (Task 3 and Task 4).
4. **A second `--open` for the same unit:** the existing issue is updated, not a second one filed. An upstream whose repository is not on GitHub, or a `gh` that fails, is exit 2 naming the repository (Task 5).
5. **The unit changed since the signals:** a session that loaded other bytes. The proposal says how many did (`olderVersion`), and the fix applies to the unit as it is now, or the reply is refused (Task 2).

## Files

| File | Responsibility |
|---|---|
| `src/loop/transcript.ts` | each signal's `task` and `actions` |
| `src/loop/misses.ts` | carry them on `MissSignal` |
| `src/report/misses.ts` | drop them from output without `--excerpts` |
| `src/loop/diagnose.ts` | `diagnosisPrompt`, `parseDiagnosis`, `applyFix` |
| `src/eval/eval.ts` | `runProbes`, the paired runner moved out of `runEval` |
| `src/loop/propose.ts` | `diagnose`: diagnosis, replay and the proposal, end to end |
| `src/report/diagnose.ts` | `renderDiagnosis` (text, json), `renderProposal` (the drafts file and the issue body) |
| `src/loop/issue.ts` | `openIssue` through `gh` |
| `src/cli.ts` | `ctxlock diagnose` |

---

### Task 1: What happened in each signal's turn

**Files:** Modify `src/loop/transcript.ts`, `src/loop/misses.ts`, `src/report/misses.ts`, and their tests.

**Interfaces:**
- Produces:
  ```ts
  // transcript.ts
  export interface Action { tool: string; target: string }   // target: command, file_path, path, pattern, skill, url or query, first found, cut to 200
  Signal.task?: string        // the opening of the typed prompt that began the signal's turn: 300 characters, pasted text removed
  Signal.actions: Action[]    // the main chain's tool uses since that prompt, up to the signal: the first 20
  // misses.ts
  MissSignal.task?: string; MissSignal.actions: Action[]
  ```
- `renderMisses` drops `task` and `actions` without `--excerpts`, as it does `words`.

- [ ] **Step 1: Write the failing tests:**
  - `a signal carries the opening of the prompt that began its turn, and the agent's actions since, with each tool's target`;
  - `actions stop at 20, and a target at 200 characters; pasted text is not in the task`;
  - `a subagent's actions are not the turn's`;
  - `misses json and text hold no task or actions without --excerpts`.
- [ ] **Step 2: Run** `npx vitest run tests/loop tests/report/misses.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: misses keeps each signal's task and the agent's actions in its turn`.

### Task 2: Asking for a diagnosis, and checking the reply

**Files:** Create `src/loop/diagnose.ts`, `tests/loop/diagnose.test.ts`.

**Interfaces:**
- Consumes: `UnitMiss` with Task 1's fields, `Unit`, `redact`, `parseProbeFile`.
- Produces:
  ```ts
  export type Verdict = 'defect' | 'gap' | 'preference' | 'agent-error' | 'unclear';
  export interface Diagnosis {
    verdict: Verdict;
    reason: string;
    quotes: string[];                                   // lines of the unit it rests on; each occurs in unit.text
    fix: { find: string; replace: string } | null;      // defect and gap only
    probe: Probe | null;                                // id `miss-${draftName(unit.id) without '.md'}`, unit = the unit's id
  }
  export class DiagnosisError extends Error {}
  export function diagnosisPrompt(unit: Unit, m: UnitMiss): string;
  export function parseDiagnosis(reply: string, unit: Unit, m: UnitMiss): Diagnosis;   // DiagnosisError naming the failed check
  export function applyFix(unit: Unit, fix: { find: string; replace: string }): { path: string; bytes: Buffer };   // the unit's text file, fixed
  ```
- **The prompt asks for exactly one fenced `json` block** with `verdict`, `reason`, `quotes`, and, for `defect` or `gap` with a correction present, `fix` and `probe` (`{ prompt, expect }` in the probe file's form).
  - **What it describes:** the verdicts, as D84 defines them. A fix is the smallest edit that would have prevented the correction.
  - **Each signal is set out as:** its kind; its date; the redacted task; the redacted actions, one per line; and, for a correction, the redacted words.
- **`parseDiagnosis` applies the checks under Global Constraints.**
  - **A fix or probe on a verdict that can't have one** is a `DiagnosisError`, as is a missing one on a `defect` or `gap` that had a correction.
  - **The probe's prompt is redacted again,** since it becomes a test in the person's repository.
- **The text file `applyFix` edits:** `unit.files[0]` for instructions and rules, or the skill's `SKILL.md`. A config unit is a `DiagnosisError`.

- [ ] **Step 1: Write the failing tests:**
  - **The prompt:**
    - `the prompt holds the unit's text and each signal's task, actions and words, redacted, and asks for one json block`.
  - **Replies that pass:**
    - `a defect reply gives its verdict, quotes, a fix that applies once, and a probe on the unit`;
    - `a preference or agent-error reply has no fix or probe, and one that carries them is refused`.
  - **Replies that are refused:** each case below is a `DiagnosisError` naming what failed (Review Focus 1).
    - no json;
    - an unknown verdict;
    - a quote not in the unit;
    - a find that occurs twice, or not at all;
    - a probe that doesn't parse.
  - **Other cases:**
    - `a defect with only interrupts has no fix, and a reply that adds one is refused`;
    - `applyFix edits the text file of a rule, an instructions file and a skill's SKILL.md, and refuses a config unit`;
    - `a fix written against older bytes than the unit's today is refused, since find no longer matches` (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run tests/loop/diagnose.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: ask Claude for a miss's diagnosis, and check its reply against the unit`.

### Task 3: Eval's paired runner, for two readers

**Files:** Modify `src/eval/eval.ts`. Tests: `tests/eval/eval.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface ProbeRun { probe: Probe; source: 'base' | 'head'; changedInHead: boolean; selectedFor: string }
  export async function runProbes(
    readers: Record<'base' | 'head', RepoReader>,
    scans: Record<'base' | 'head', ScanResult>,
    runs: ProbeRun[],
    opts: Pick<EvalOptions, 'runs' | 'maxRuns' | 'maxMinutes' | 'model' | 'claude' | 'workdir' | 'cacheDir' | 'ctxlockVersion' | 'keepRuns' | 'now'> & { trees: Record<'base' | 'head', string | null> },
  ): Promise<Pick<EvalResult, 'model' | 'claudeVersion' | 'outcomes' | 'stripped' | 'gateFailures' | 'totals'>>;
  ```
- Move `runEval`'s body from the run folder onward into `runProbes`: materializing, the cache, the budgets, the runs and the outcomes. `runEval` keeps selection and calls it.
- A `null` tree is never cached, as a working-tree arm isn't today.
- **The existing eval tests pass unedited.**

- [ ] **Step 1: Write the failing test:** `runProbes runs a probe against two readers, one an overlay, and reports it improved when only the overlay passes`.
- [ ] **Step 2: Run** `npx vitest run tests/eval`. Expected: the new test FAILS, and the rest pass.
- [ ] **Step 3: Implement** the move.
- [ ] **Step 4: Run** `npx vitest run tests/eval tests/cli.test.ts`. Expected: PASS. **Commit** `refactor: eval's paired runner takes two readers`.

### Task 4: `ctxlock diagnose`

**Files:** Create `src/loop/propose.ts`, `src/report/diagnose.ts`, `tests/loop/propose.test.ts`, `tests/report/diagnose.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`, `the-guide/commands.md`.

**Interfaces:**
- Consumes: Tasks 1–3; `findMisses`; `runClaude`, `overlayReader`, `loadProbes`, `fsReader`.
- Moves the `misses` command's reading of events and transcripts into `async function missesAt(root: string, scan: ScanResult, opts: { minSessions: number; since?: string }): Promise<Misses>` in `src/cli.ts`, which both commands call.
- Produces:
  ```ts
  // propose.ts
  export type Replay = { status: 'validated' | 'not-validated' | 'inconclusive'; miss: ProbeOutcome; others: ProbeOutcome[] };
  export interface Proposal { unit: UnitMiss; diagnosis: Diagnosis; replay: Replay | null; runs: number; tier: Tier }
  export async function diagnose(opts: { root: string; miss: UnitMiss; model: string; claude: string[]; workdir: string; runs: number; maxRuns: number; maxMinutes: number }): Promise<Proposal>;
  // report/diagnose.ts
  export function renderDiagnosis(p: Proposal, format: 'text' | 'json'): string;
  export function renderProposal(p: Proposal, repo: string): string;   // DRAFT_MARK-style marker with a digest; the drafts file and the issue body
  ```
- **The command:** `ctxlock diagnose <unit> [dir] [--since] [--runs <n> (2)] [--max-runs <n> (16)] [--max-minutes <n> (15)] [--model] [--claude] [--workdir] [--drafts <folder>] [--format text|json]`.
  - The unit must be among `misses`' units, joined to at least one signal. It need not be routed, so the owner of a unit below the threshold can still ask.
- **The replay:**
  - **The two copies:** `base` is `fsReader(root, { local: false })`, and `head` is `overlayReader(base, applyFix(...))`.
  - **What runs:** the miss's probe as a `head`-source run, and the unit's existing probes as `base`-source runs, all through `runProbes`.
  - **The status:** `validated` when the miss probe is `improved` and no other probe `regressed`; `inconclusive` when any run hit a budget; otherwise `not-validated`.
- **The text output:** the verdict and reason, the quotes, the fix as a two-line `-`/`+` diff, the probe, then the replay with each probe's base and head passes, and the runs used.
  - For a `certified` unit it adds: "This unit is certified: the fix needs its owner's approval."
  - With `--drafts`, `renderProposal` goes to `<draftName stem>.fix.md`, under `misses --drafts`' marker rules.

- [ ] **Step 1: Write the failing tests.** They use the stand-in Claude (`tests/helpers/fake-claude.mjs`): one behaviour answers the diagnosis prompt, and others act on the probe's prompt differently in each copy.
  - **The flow:**
    - `diagnose replays a defect's fix: the miss probe fails as the unit is and passes fixed, so the proposal is validated`;
    - `a fix that changes nothing the agent does, or that makes the unit's other probe worse, is not validated` (Review Focus 3);
    - `a preference verdict runs no replay`;
    - `a unit with no signal in context, and an unknown unit, are exit 2`.
  - **The output:**
    - `a certified unit's proposal says the fix needs its owner's approval`;
    - `--drafts writes the proposal beside the unit's draft, and leaves one edited since`;
    - `nothing in the repository changes, the probe files included`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/propose.test.ts tests/report/diagnose.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and add `ctxlock diagnose` to `the-guide/commands.md`.
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: ctxlock diagnose turns a routed unit into a diagnosed fix, checked by replay`.

### Task 5: Filing the issue

**Files:** Create `src/loop/issue.ts`, `tests/loop/issue.test.ts`. Modify `src/cli.ts`, `tests/cli.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export class IssueError extends Error {}
  export function githubRepo(repo: string): string | null;   // owner/name from an https, ssh or scp GitHub URL, else null
  export async function openIssue(repo: string, title: string, body: string, marker: string, gh?: string[]): Promise<{ number: number; url: string; created: boolean }>;
  ```
- **Finding the issue:** `gh issue list -R <repo> --state all --search "<marker> in:body" --json number,url,body --limit 20`. The first whose body contains the marker exactly is updated with `gh issue edit <n> -R <repo> --body-file -`. Otherwise `gh issue create -R <repo> --title <title> --body-file -` files a new one.
- **How `gh` runs:** with `execFile`, never a shell, and the body on stdin.
- **The command:** `ctxlock diagnose --open`, for `defect` and `gap` only.
  - **The title:** `ctxlock: <unit id> needs a look`.
  - **The body:** `renderProposal`.
  - **The repository:** for a synced unit, the upstream's repository; otherwise this repository's `origin`. Either must be a GitHub repository, or it is exit 2 naming it.

- [ ] **Step 1: Write the failing tests.** They use a stand-in `gh` that records its arguments and stdin, in the way `tests/templates.test.ts` does.
  - **The repository:**
    - `githubRepo reads https, ssh and scp GitHub URLs, and gives null for a local path or another host`.
  - **Filing:**
    - `openIssue files a new issue with the body on stdin`;
    - `a second openIssue for the same marker edits that issue instead` (Review Focus 4).
  - **Failing:**
    - `a gh that fails is an IssueError naming the repository`.
  - **The command:**
    - `diagnose --open files for a defect, in the upstream's repository for a synced unit, and files nothing for a preference`.
- [ ] **Step 2: Run** `npx vitest run tests/loop/issue.test.ts tests/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS. **Commit** `feat: diagnose --open files one issue per unit for its owner`.

### Task 6: The live run, docs and decisions

**Files:**
- Create `docs/dogfood/2026-11-12-diagnose.md`, `journey/15-diagnose.md`, and `F:/ctxlock-live/loop/`, outside the repository.
- Modify `the-guide/misses.md`, `the-guide/README.md`, `README.md`, `journey/README.md`, `journey/decisions.md`, and this plan's progress table.

- [ ] **Step 1: The live run (D88).**
  - **The fixture:** a repository whose `.claude/rules/deps.md` says "Install packages with npm install", while its `package.json` names pnpm.
  - **The session:** one in Claude Code's own shape, in a scratch `CLAUDE_CONFIG_DIR` and `CTXLOCK_HOME`:
    - the person asks to add a package;
    - the agent runs `npm install`;
    - the person writes "no, we use pnpm here".
  - **The run:** `ctxlock diagnose rule/.claude/rules/deps.md` with real Claude Code.
  - **What to record:** the verdict, the fix, the probe, each arm's passes, the runs and the minutes. Nothing goes to GitHub.
- [ ] **Step 2: Docs.**
  - **`the-guide/misses.md`:** a section on `diagnose` covering:
    - what it sends;
    - the verdicts;
    - the fix and the probe;
    - replay and what "validated" means;
    - `--open`.

    The section on what it doesn't do yet is updated.
  - **README:** the "What it can do today" item and the roadmap's sub-item.
  - **`journey/15-diagnose.md`.**
  - **`journey/decisions.md`:** D83–D88.
- [ ] **Step 3: Run** `npm run ci`. Expected: PASS. **Commit** `docs: ctxlock diagnose in the guide, the live run, and D83-D88`, push, and watch both operating systems' CI.

## After this plan

Plan 9:
- **Durability:** whether a shipped fix still holds at 7 and 30 days, and whether its unit's misses stopped.
- **Counters:** helpful/harmful counts per unit, and re-verification when `stale-after` passes.
- **The compounding metrics:** time from first signal to shipped fix, the regression rate, fixes times consumers reached, and units never loaded.
