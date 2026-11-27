# Suppressions, audited exceptions and unused ignores: Implementation Plan (Plan 16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams can quiet a finding precisely and accountably. Inline directives cover quality rules, `lint.exceptions` with an owner and expiry covers any rule, and every quieting, and every ignore that quiets nothing, is reported.

**Architecture:** One filter inside `runLint`, which every command already passes through.
- `src/lint/suppress.ts` owns the directive grammar, exception matching and the L18 findings.
- `runLint` applies `severity`, then `quiet()`, which applies exceptions, then directives, then `lint.ignore`.
- `L1-html-comment` exempts a valid directive only when `ctx.suppressions` is not `false`. `check` scans with `suppressions: false`.

**Tech Stack:** TypeScript ESM, Node 22, vitest, zod, picomatch. No new dependency.

**Spec:** [docs/superpowers/specs/2026-11-24-ctxlock-suppressions-design.md](../specs/2026-11-24-ctxlock-suppressions-design.md). Approved by Satyam on 2026-11-27.

## Global Constraints

- **Never inline:** a rule whose id starts with `L0-`, `L1-`, `L2-`, `L14-`, `L16-` or `L18-`.
- **Directive grammar, one line:**
  - It starts `<!--`, then optional spaces, then `ctxlock-ignore-next-line` or `ctxlock-ignore-file`.
  - Then one or more ids separated by spaces. An id is `L<digits>-<lowercase words joined by ->` or `agnix:[A-Za-z0-9_.-]+`.
  - Then `:`, then a reason of 1–200 characters after trimming, then optional spaces, then `-->`.
  - Ids are checked by syntax only. An id that ctxlock does not know is still valid.
- **Directives count only in `.md` files, outside code**, found as `L1-html-comment` finds comments (`maskCode`).
- **`next-line`** targets the first non-blank line after the directive's line. **`file`** targets every finding of the named rules in that file.
- **Exception keys:** `rule`, `path` (exact repo path), `fingerprint` (`sha256:` plus 64 hex digits), `match` (substring of the message), `owner`, `reason`, `expires` (`YYYY-MM-DD`).
  - `owner`, `reason` and `expires` are required.
  - `L1-` rules require `fingerprint`. Other `L0-` and `L2-` rules require `fingerprint` or `match`.
- **An exception applies while `today <= expires`.**
- **`lint.severity` naming an `L18-` rule** is a `ctxlock.yaml` error (exit 2).
- **L18 rules:** `L18-suppressed` (info), `L18-unused` (should), `L18-exception-expired` (should). L18 findings are added after all filtering, so nothing drops them.
- **Filter order:** severity (with `off`), then exceptions, then directives, then `lint.ignore`. A finding quieted earlier does not count as used later.
- **`agnix:`-only directives and exceptions** are never `L18-unused` unless agnix ran.
- **`check` passes `suppressions: false`.** Its output must not change for any input.
- **`ctxlock.yaml` stays `version: 1`**, and JSON output keeps its shape.

## Review Focus

1. **A directive inside a fenced or inline code block** (a doc showing the syntax) is not a directive. It quiets nothing and is reported as `L1-html-comment` as today. → Task 2 test.
2. **A pull request that adds an exception to `ctxlock.yaml` together with the must it excepts** still fails `diff`, because exceptions come from the base. The same exception already on the base lets it pass. → Task 3 test.
3. **A `lint.ignore` of `"**"`** quiets every ordinary finding but none of L18, and is not itself unused. → Task 1 test.
4. **A repository with CRLF line endings:** `next-line` still targets the right line. → Task 2 test.
5. **Two directives targeting the same finding:** the first in file order is used and the second is `L18-unused`, so the count stays honest. → Task 2 test.

---

### Task 1: Exceptions, `lint.ignore` reporting and the L18 rules

**Files:**
- Create: `src/lint/suppress.ts`, `tests/lint/suppress.test.ts`
- Modify:
  - `src/registry/registry.ts`: the `lint` schema at lines 140–144 and the `Registry.lint` type at line 63;
  - `src/lint/run.ts`: lines 51–70, `runLint`;
  - `src/check.ts`: line 29, `DEFAULTS` gets `exceptions: []`;
  - `tests/registry/registry.test.ts`: line 24, the expected default.

**Interfaces:**
- Produces, in `src/registry/registry.ts`:
  - `export interface LintException { rule: string; path: string; fingerprint?: string; match?: string; owner: string; reason: string; expires: string }`;
  - `Registry.lint` becomes `{ severity: Record<string, Severity | 'off'>; ignore: string[]; exceptions: LintException[] }`.
- Produces, in `src/lint/suppress.ts`:
  - `export interface Directive { path: string; line: number; scope: 'next-line' | 'file'; rules: string[]; reason: string; target: number | null }`;
  - `export function quiet(findings: Finding[], ctx: LintContext, directives: Directive[]): Finding[]`. It takes findings after `severity`, applies exceptions, then directives, then `lint.ignore`, and returns the kept findings followed by the L18 findings. Task 1 always passes `directives` as `[]`; Task 2 fills it.
- Produces, in `src/lint/types.ts`: `LintContext` gains `agnixRan?: boolean` (undefined means it did not run). `scanRepo` sets it from `opts.agnix`.

- [ ] **Step 1: Write the failing tests** in `tests/lint/suppress.test.ts`, through `runLint(await lintContext(files), extra)` with fake findings, as `tests/lint/run.test.ts` does. `lintContext` uses `today: '2026-11-05'`.
  - `an exception quiets its rule on its path until it expires, and says so`:
    - with `{ rule: X-a, path: a.md, owner: "@sam", reason: one-off, expires: 2026-11-05 }`, a `X-a must a.md` finding is gone;
    - out contains `{ rule: 'L18-suppressed', severity: 'info', path: 'a.md', message: 'exception for X-a on a.md quiets 1 finding, owner @sam, until 2026-11-05: one-off' }`;
    - with `expires: 2026-11-04`, the `X-a` finding stays, and out contains `{ rule: 'L18-exception-expired', severity: 'should', path: 'ctxlock.yaml', message: 'exception for X-a on a.md expired on 2026-11-04 (owner @sam); its findings are back' }`.
  - `an exception matches only its own fingerprint or text`:
    - an `L1-html-comment` exception with `fingerprint: sha256:<64 a's>` quiets a finding with that `data.fingerprint`, and not one with another;
    - a `match: "U+200B"` exception on `X-b` quiets a message containing it, and not one without it.
  - `an exception that quiets nothing is unused, and so is one for a rule switched off`:
    - out contains `{ rule: 'L18-unused', severity: 'should', path: 'ctxlock.yaml', message: 'exception for X-c on c.md quiets nothing' }`;
    - with `severity: { X-d: off }` and an exception for `X-d`, the exception is unused.
  - `a lint.ignore pattern that quiets nothing is unused, and "**" cannot drop L18`:
    - `ignore: ["vendor/**", "old/**"]` with a finding under `vendor/` gives exactly one `L18-unused` with message `lint.ignore pattern "old/**" quiets nothing`;
    - `ignore: ["**"]` together with an unused exception keeps that `L18-unused`, and the `**` pattern is not reported unused.
  - `an agnix exception is not unused when agnix did not run`: an exception for `agnix:CC-SK-001` gives no L18 finding with `agnixRan` unset, and gives `L18-unused` with `ctx.agnixRan = true`.
  - In `tests/registry/registry.test.ts`, `lint.exceptions is validated`:
    - a missing `owner`, a missing `expires`, or `expires: tomorrow` is a `RegistryError`;
    - an `L1-html-comment` exception without `fingerprint` is a `RegistryError` naming `fingerprint`;
    - an `L2-risky-instruction` exception with neither key is a `RegistryError`;
    - `severity: { L18-unused: "off" }` is a `RegistryError`;
    - a valid exception loads as `{ rule, path, owner, reason, expires }`, with `path` normalised by `repoPath`.
  - Update the default at line 24 to `lint: { severity: {}, ignore: [], exceptions: [] }`.

- [ ] **Step 2: Run and watch them fail.** Run `npx vitest run tests/lint/suppress.test.ts tests/registry/registry.test.ts`. Expected: FAIL, because no exceptions key exists (strict schema) and no L18 findings appear.

- [ ] **Step 3: Implement.**
  - **Registry:** a `z.strictObject` per exception with a `superRefine` for the fingerprint/match rule; a refine on `severity` keys rejecting `/^L18-/`; and `exceptions` defaulting to `[]`. Reuse the file's `date` schema and `repoPath`.
  - **`quiet()`:** for each step, a `used` counter per exception, per directive and per ignore pattern.
  - **Messages are exact:**
    - suppressed: `exception for ${rule} on ${path} quiets ${n} ${n === 1 ? 'finding' : 'findings'}, owner ${owner}, until ${expires}: ${reason}`;
    - unused: `exception for ${rule} on ${path} quiets nothing`;
    - expired: as in the test;
    - ignore: `lint.ignore pattern "${p}" quiets nothing`.
  - **`runLint`:** keep its severity loop, then call `quiet(kept, ctx, [])` in place of today's `ignored(...)` check, then dedupe and sort as now.

- [ ] **Step 4: Run them, then the whole suite.** `npx vitest run tests/lint tests/registry tests/check.test.ts` must PASS. Then run `npx vitest run` and fix what the new `L18-unused` breaks. Expected: existing tests whose fixtures carry an unused `lint.ignore`. Each fix keeps the test's intent; a test that pinned full output gains the L18 line.

- [ ] **Step 5: Mutation-check and commit.** Mutations to run:
  - drop the expiry comparison;
  - drop the fingerprint condition;
  - move ignore before exceptions;
  - let `**` drop L18;
  - report agnix exceptions as unused unconditionally.

  Each must fail a test. Commit `feat: audited exceptions in ctxlock.yaml, and ignores that quiet nothing are reported`, then push.

### Task 2: Inline directives

**Files:**
- Modify:
  - `src/lint/rules/l1-hidden.ts`: lines 140–165, `htmlComment`;
  - `src/lint/suppress.ts`;
  - `src/lint/run.ts`;
  - `src/lint/types.ts`;
  - `src/scan.ts`: `ScanOptions`, and the ctx at line ~73;
  - `src/check.ts`: both `scanRepo` calls.
- Test: `tests/lint/suppress.test.ts`, `tests/lint/l1.test.ts`, `tests/check.test.ts`

**Interfaces:**
- Consumes: `quiet()` and `Directive` (Task 1).
- Produces, in `src/lint/rules/l1-hidden.ts`: `export function htmlComments(text: string): Array<{ comment: string; line: number; column: number }>`. It is the existing `maskCode(text).matchAll(...)` loop, which `htmlComment` then uses itself.
- Produces, in `src/lint/suppress.ts`:
  - `export function parseDirective(comment: string): Pick<Directive, 'scope' | 'rules' | 'reason'> | null`. It returns `null` for anything off-grammar, or naming a never-inline rule.
  - `export async function findDirectives(ctx: LintContext): Promise<Directive[]>`, over `textFiles(ctx, undefined, true)` `.md` files.
- Produces:
  - `LintContext.suppressions?: boolean`, where `false` means no directive or exception applies;
  - `ScanOptions.suppressions?: boolean` (default `true`).

- [ ] **Step 1: Write the failing tests.**
  - `parseDirective accepts the grammar and nothing else`, as a table:
    - accepted:
      - `<!-- ctxlock-ignore-next-line L5-instruction-count: one list -->` gives `{ scope: 'next-line', rules: ['L5-instruction-count'], reason: 'one list' }`;
      - `<!--ctxlock-ignore-file L6-skill-length L9-stale:generated-->`;
      - `agnix:CC-SK-001`;
      - an unknown `L99-new-rule`.
    - `null`:
      - no reason;
      - a reason of 201 characters;
      - `L1-hidden-unicode`, `L2-risky-instruction`, `L14-generated`, `L16-lock` or `L18-unused`;
      - `l5-instruction-count`;
      - a two-line comment;
      - `ctxlock-ignore L5-instruction-count: x`, which lacks a scope.
  - `a next-line directive quiets the next non-blank line's finding of that rule, and says why`: `AGENTS.md` = `<!-- ctxlock-ignore-next-line X-a: on purpose -->\n\n- rule\n`, with extra findings `X-a should AGENTS.md:3` and `X-a should AGENTS.md:4`.
    - Line 3 is gone and line 4 stays.
    - out contains `{ rule: 'L18-suppressed', severity: 'info', path: 'AGENTS.md', line: 1, message: 'ctxlock-ignore-next-line quiets 1 finding of X-a: on purpose' }`.
    - The same file with `\r\n` line endings gives the same result.
  - `a file directive quiets that rule anywhere in the file, with or without a line`.
  - `a directive that quiets nothing is unused, and one naming an unknown rule says so`:
    - message `ctxlock-ignore-file X-z quiets nothing: why`;
    - for `L99-new-rule`, `ctxlock-ignore-file L99-new-rule quiets nothing; ctxlock has no rule L99-new-rule: why`.
  - `two directives on one finding: the first is used, the second unused`.
  - `a directive in a code block is documentation`: `` ```md\n<!-- ctxlock-ignore-file X-a: x -->\n``` `` quiets nothing, gives no L18 finding, and gives an `L1-html-comment` finding.
  - `an exception wins before a directive`: when both target a finding, the exception is used and the directive is unused.
  - In `tests/lint/l1.test.ts`, `a valid directive is not a hidden comment, an invalid one is, and with suppressions off every one is`:
    - the valid directive gives no `L1-html-comment`;
    - `<!-- ctxlock-ignore-file L1-hidden-unicode: fine -->` gives an `L1-html-comment` must;
    - with `ctx.suppressions = false`, the valid one gives an `L1-html-comment` must.
  - In `tests/check.test.ts`, `a stranger's suppression comment is hidden text in check`: a folder whose `AGENTS.md` holds a valid `ctxlock-ignore-file L5-instruction-count: x` directive has that comment in `result.must` as `L1-html-comment`.

- [ ] **Step 2: Run and watch them fail.** Run `npx vitest run tests/lint tests/check.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `findDirectives` takes the line from `htmlComments`, and the target as the first later line whose trim is non-empty, on a `\r\n`-normalised split.
  - `runLint` calls `quiet(kept, ctx, ctx.suppressions === false ? [] : await findDirectives(ctx))`. With `suppressions: false`, `quiet` also skips exceptions.
  - `htmlComment` skips a comment when `ctx.suppressions !== false && parseDirective(comment)`.
  - `scanRepo` sets `suppressions: opts.suppressions` on ctx. `check.ts` passes `suppressions: false` on both scans.
  - Directive messages:
    - suppressed: `ctxlock-ignore-${scope} quiets ${n} ${finding|findings} of ${rules.join(', ')}: ${reason}`;
    - unused: `ctxlock-ignore-${scope} ${rules.join(' ')} quiets nothing${unknown.length ? `; ctxlock has no rule ${unknown.join(', ')}` : ''}: ${reason}`.
  - Known ids are an exported `KNOWN_RULES: ReadonlySet<string>` in `suppress.ts`. List every id the rules emit; get them with `grep -rhoE "rule: '[^']+'" src | sort -u`, plus `L2-exec-config-changed` and the L18 ids.

- [ ] **Step 4: Run them, then the whole suite.** `npx vitest run` must PASS.

- [ ] **Step 5: Mutation-check and commit.** Mutations to run:
  - accept `L1-` ids inline;
  - drop the code-block masking for directives;
  - target the directive's own line;
  - drop `suppressions: false` in `check`;
  - let the exemption ignore `ctx.suppressions`;
  - count a finding quieted twice.

  Each must fail a test. Commit `feat: inline ctxlock-ignore directives for quality rules, each reported with its reason`, then push.

### Task 3: `diff` end to end, docs and a live run

**Files:**
- Test: `tests/diff.test.ts`, after `'a pull request cannot switch off the checks that judge it: settings come from the base'`
- Modify:
  - `the-guide/configuration.md`: `lint.exceptions` in the example and the field table;
  - `the-guide/rules.md`: an L18 section, a "Quieting a finding" section, and one line under `L1-html-comment` for the directive exemption;
  - `journey/decisions.md`: D126 to D130, after D125;
  - `journey/README.md`: the Latest line.
- Create: `journey/22-suppressions.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing tests** in `tests/diff.test.ts`.
  - `an exception added with the must it excepts does not pass the pull request; on the base it does`:
    - the base is `AGENTS.md: "a"`;
    - the head adds `ctxlock.yaml` with an `L1-hidden-unicode` exception (fingerprint taken from a first `--format json` run) and a zero-width space in `AGENTS.md`;
    - `diff` exits 1;
    - a second repository whose base already has that exception exits 0, with `L18-suppressed` in its JSON `newFindings`.
  - `a new inline directive shows in the diff with its reason`: the head adds `<!-- ctxlock-ignore-file L6-skill-length: generated from the spec -->` to a 600-line skill. The JSON `newFindings` contain `L18-suppressed` with that reason, and the exit is 0.

- [ ] **Step 2: Run them.** They should PASS from Tasks 1–2. A failure is a finding about those tasks: fix it test-first, and ledger it.

- [ ] **Step 3: Live run.**
  - Run `node dist/cli.js lint .` on this repository and on `F:/ctxlock-live/repos/*`.
  - Every `L18-unused` must be real. Fix this repository's own config if it has one.
  - Then add one real directive somewhere it earns its keep, and show the `L18-suppressed` line in `the-guide/rules.md`.

- [ ] **Step 4: Docs.**
  - **Decisions:**
    - D126: option C, and why L14 and L16 are never inline.
    - D127: rule ids checked by syntax.
    - D128: fingerprints for `L1-` exceptions.
    - D129: no severity for L18.
    - D130: `check` passes `suppressions: false`.
  - **Journey chapter 22:** what exists now, and what went wrong.

- [ ] **Step 5: `npm run ci`, commit and push.** Commit `docs: quieting a finding, with a reason, an owner and an end date`, then push.
