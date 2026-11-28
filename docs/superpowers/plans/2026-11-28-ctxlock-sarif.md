# SARIF output and an opt-in code-scanning upload: Implementation Plan (Plan 17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctxlock lint --format sarif` writes a SARIF 2.1.0 log, and the Action uploads it to GitHub code scanning when `sarif: true`, on pull requests and on pushes.

**Architecture:**
- **Renderer:** `src/report/sarif.ts` renders lint's findings, taking alert identity from `diff`'s own matching key.
- **CLI:** the lint command gains the `sarif` format.
- **Action:** `action.yml` gains a Write SARIF step, an upload step that continues on error, and a warning step. On a push with no base ref, the `diff` step is skipped instead of failing.

**Tech Stack:** TypeScript ESM, Node 22, vitest, commander, a composite GitHub Action (bash). No new dependency.

**Spec:** [docs/superpowers/specs/2026-11-28-ctxlock-sarif-design.md](../specs/2026-11-28-ctxlock-sarif-design.md). Approved by Satyam on 2026-11-28.

## Global Constraints

- **The log:** SARIF `version: "2.1.0"`, `$schema: "https://json.schemastore.org/sarif-2.1.0.json"`, one run.
- **The tool:** `tool.driver.name: "ctxlock"`, with the package version and `informationUri: "https://github.com/SatyamSingh-Git/ctxlock"`.
- **Rules:** one `rules` entry per rule id present, with `helpUri: "https://github.com/SatyamSingh-Git/ctxlock/blob/main/the-guide/rules.md"` and `defaultConfiguration.level` taken from the rule's first finding.
- **Levels:** must → `error`, should → `warning`, info → `note`.
- **Location:** `artifactLocation: { uri: <path>, uriBaseId: "%SRCROOT%" }`. `region.startLine` is the finding's line, or 1, plus `startColumn` when there is one.
- **Fingerprints:** `partialFingerprints.primaryLocationLineHash` is `<sha256 hex of diff's key(finding)>:<n>`, where `n` is 1 for the first result with that key, 2 for the next, and so on.
- **Findings left out:** one with no `path`, or whose path is not a file of the scanned tree.
- **`lint --format sarif`** prints to stdout, with exit codes unchanged.
- **The Action:**
  - input `sarif`, default `'false'`;
  - upload with `github/codeql-action/upload-sarif@v4`, `category: ctxlock`;
  - the upload continues on error, and a failure prints a `::warning::`;
  - the Result step's decision on pull requests is unchanged;
  - on a push with `sarif: 'true'` and no base, the `diff` step is skipped and the job passes unless the SARIF could not be written.

## Review Focus

1. **A path with spaces or non-ASCII characters** (`docs/My Rules.md`). The URI must be what code scanning resolves, so percent-encode each segment. → Task 1 test.
2. **Two identical findings, such as a hidden character repeated on one line:** two results with fingerprints ending `:1` and `:2`. → Task 1 test.
3. **`lint --format sarif` on a repository with a `must`:** valid SARIF on stdout and exit 1, so the Action must not treat exit 1 as "no file". → Task 2 test.
4. **A Windows path separator** never reaches a URI. Paths are repository paths with `/` already, so a test pins `.claude/rules/x.md`. → Task 1 test.
5. **A finding whose message holds a control character:** the JSON stays valid and parses back to the same text. → Task 1 test.

---

### Task 1: The SARIF renderer and `lint --format sarif`

**Files:**
- Create: `src/report/sarif.ts`, `tests/report/sarif.test.ts`
- Modify:
  - `src/diff.ts`: line 29, `export` the `key` function as `findingKey`;
  - `src/cli.ts`: lines 263–275, where the lint view's `--format` choices gain `sarif`, which reaches the new renderer.
- Test: `tests/cli.test.ts`, a new `describe('ctxlock lint --format sarif')` at the end.

**Interfaces:**
- Produces, in `src/diff.ts`: `export const findingKey = (f: Finding) => string`, which is the existing `key`, renamed, with diff's own uses updated.
- Produces, in `src/report/sarif.ts`: `export function renderSarif(findings: Finding[], files: ReadonlySet<string>, version: string): string`. It returns pretty JSON plus a newline.

- [ ] **Step 1: Write the failing tests** in `tests/report/sarif.test.ts`.
  - `a must, a should and an info become one result each, with rules, levels and locations`:
    - input: findings `L1-hidden-unicode must AGENTS.md:3:7`, `L9-stale should docs/My Rules.md:2` and `L11-coverage info .claude/rules/x.md`;
    - `files` holds all three paths, and `version` is `'9.9.9'`;
    - parsed: `version '2.1.0'`, `runs[0].tool.driver.name 'ctxlock'`, `driver.version '9.9.9'`;
    - `driver.rules.map(r => r.id)` is `['L1-hidden-unicode', 'L9-stale', 'L11-coverage']`;
    - results `[ruleId, level]` are `[['L1-hidden-unicode','error'],['L9-stale','warning'],['L11-coverage','note']]`;
    - the first location is `{ physicalLocation: { artifactLocation: { uri: 'AGENTS.md', uriBaseId: '%SRCROOT%' }, region: { startLine: 3, startColumn: 7 } } }`;
    - the second URI is `'docs/My%20Rules.md'`;
    - the third has `region: { startLine: 1 }` and URI `'.claude/rules/x.md'`.
  - `findings with no file in the tree are left out`: one with no path and one whose path is not in `files` give `results: []`.
  - `identical findings get fingerprints ending :1 and :2, and a moved finding keeps its own`:
    - two identical findings give `primaryLocationLineHash` values that share a prefix and end `:1` and `:2`;
    - the same finding at line 3 and at line 9 gives equal hashes (`findingKey` drops positions).
  - `a control character in a message survives as JSON`: a message with U+001B parses back equal.

  In `tests/cli.test.ts`:
  - `lint --format sarif prints SARIF and exits 1 on a must`: a temp folder whose `AGENTS.md` holds a zero-width space gives exit 1, stdout parsing as JSON with `runs[0].results[0].ruleId === 'L1-hidden-unicode'`, and the result's URI `'AGENTS.md'`.
  - `scan and budget refuse --format sarif`: exit 2.

- [ ] **Step 2: Run and watch them fail.** Run `npx vitest run tests/report/sarif.test.ts tests/cli.test.ts -t "sarif"`. Expected: FAIL, because there is no module and no format choice.

- [ ] **Step 3: Implement.**
  - The URI is `path.split('/').map(encodeURIComponent).join('/')`.
  - The fingerprint is `createHash('sha256').update(findingKey(f)).digest('hex')`, plus the occurrence count.
  - In `cli.ts`, the lint view's choices are `['text', 'json', 'sarif']`; scan and budget keep `['text', 'json']`. For `sarif`, print `renderSarif(result.findings, new Set(await reader.listFiles()), VERSION)`, reusing the `fsReader(root)` the scan used.

- [ ] **Step 4: Run, typecheck, mutation-check.** The tests must PASS, then run `npx tsc --noEmit -p .`. Mutations to run:
  - drop the `:n` count;
  - use the message in place of `findingKey`;
  - map `should` to `note`;
  - drop the file filter;
  - skip the URI encoding.

  Each must fail a test.

- [ ] **Step 5: Commit and push.** `feat: ctxlock lint --format sarif, for code scanning and the VS Code SARIF viewer`.

### Task 2: The Action's `sarif` input

**Files:**
- Modify: `action.yml`
- Test: `tests/action.test.ts`

**Interfaces:**
- Consumes: `lint --format sarif` (Task 1).
- Produces, in `action.yml`:
  - **input:** `sarif`;
  - **`Check context` (`id: diff`):** gains env `SARIF: ${{ inputs.sarif }}`. With an empty `BASE` and `SARIF` equal to `true`, it writes `skipped=true` to `GITHUB_OUTPUT`, and writes no report and no `exit-code`.
  - **`Write SARIF` (`id: sarif`):** has `if: always() && inputs.sarif == 'true'`. It runs `node "$GITHUB_ACTION_PATH/dist/cli.js" lint --format sarif "$GITHUB_WORKSPACE" > "$RUNNER_TEMP/ctxlock.sarif"`, and writes `written=true` when that file is not empty.
  - **`Upload SARIF` (`id: upload`):** has `if: always() && steps.sarif.outputs.written == 'true'` and `continue-on-error: true`. It uses `github/codeql-action/upload-sarif@v4` with `sarif_file: ${{ runner.temp }}/ctxlock.sarif` and `category: ctxlock`.
  - **`SARIF upload warning`:** has `if: always() && steps.upload.outcome == 'failure'`. It echoes `::warning title=ctxlock::the SARIF upload failed. Pull requests from forks get a read-only token, private repositories need GitHub Code Security, and the workflow needs security-events: write`.
  - **`Result`:** gains env `SKIPPED: ${{ steps.diff.outputs.skipped }}`, `SARIF: ${{ inputs.sarif }}` and `SARIF_WRITTEN: ${{ steps.sarif.outputs.written }}`. When `SKIPPED` is `true`, it exits 0 if `SARIF_WRITTEN` is `true`, and otherwise prints `::error title=ctxlock::could not write the SARIF; the job log has the reason` and exits 1. When `SARIF` is `true`, `SKIPPED` is not, and `SARIF_WRITTEN` is not `true`, it prints a `::warning::` and keeps today's decision.

- [ ] **Step 1: Write the failing tests** in `tests/action.test.ts`, with the existing stand-in pattern.
  - `a push with sarif on and no base skips the diff instead of failing`: the `Check context` script with `BASE=''` and `SARIF='true'` exits 0, writes `skipped=true`, writes no `exit-code=`, and creates no `ctxlock.md`. With `SARIF='false'`, it still says "no base ref" (today's test keeps passing).
  - `Write SARIF keeps the file when lint exits 1 on a must, and says when there is none`:
    - a stand-in that prints `{"version":"2.1.0"}` and exits 1 leaves `ctxlock.sarif` with that text, `written=true`, and a step status of 0;
    - one that prints nothing and exits 2 gives no `written=` and status 0.
  - `the Result step: a skipped diff passes when the SARIF was written, and fails when it was not`: `result` gains `skipped` and `written` parameters; `('', 'true', '', 'false', 'true', 'true')` gives 0, and `('', 'true', '', 'false', 'true', '')` gives 1.
  - `the upload continues on error, is pinned to v4 with category ctxlock, and a failure warns`, asserted from the parsed `steps`:
    - the step named `Upload SARIF` has `uses: 'github/codeql-action/upload-sarif@v4'`, `with.category: 'ctxlock'` and `'continue-on-error': true`;
    - `SARIF upload warning`'s `if` contains `steps.upload.outcome == 'failure'`;
    - `inputs.sarif.default` is `'false'`.

- [ ] **Step 2: Run and watch them fail.** Run `npx vitest run tests/action.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the steps and inputs as the Interfaces block says. Keep every input reaching scripts through `env`; the existing test that forbids `${{ }}` inside `run` guards this.

- [ ] **Step 4: Run and mutation-check.** `npx vitest run tests/action.test.ts` must PASS. Mutations to run:
  - drop `continue-on-error`;
  - remove the `skipped` branch from `Result`;
  - make `Write SARIF` require exit 0.

  Each must fail a test.

- [ ] **Step 5: Commit and push.** `feat: the Action uploads lint's SARIF to code scanning when sarif is true`.

### Task 3: Docs and a live upload

**Files:**
- Modify:
  - `the-guide/github-action.md`: the `sarif` input in the inputs table, and a new section "Code scanning";
  - `the-guide/commands.md`: `--format sarif` in the lint options;
  - `README.md`: one row in the Action inputs table;
  - `.github/workflows/self-test.yml`;
  - `journey/decisions.md`: D133–D136 after D132;
  - `journey/README.md`: the Latest line.
- Create: `journey/23-sarif.md`

- [ ] **Step 1: The guide.** The new section covers:
  - the workflow, with `on: pull_request` and `push: branches: [main]`, and `permissions: security-events: write`;
  - what shows where: alerts in the Security tab, and annotations on a pull request's changed lines;
  - code scanning's own "Code scanning results" check: it fails on new `error` results by default, and the threshold is under the repository's Settings → Code security → Code scanning → Protection rules;
  - findings left out because they have no file;
  - forks and private repositories;
  - VS Code: open the file with the SARIF Viewer extension.

- [ ] **Step 2: The live upload.**
  - In `self-test.yml`, add `push: branches: [main]`, add `security-events: write` to `permissions`, and pass `with: sarif: 'true'`. Push.
  - Wait for the run with `gh run watch`.
  - Check the upload with `gh api repos/SatyamSingh-Git/ctxlock/code-scanning/analyses --jq '.[0] | {tool: .tool.name, category, results_count}'`, and the alerts with `gh api repos/SatyamSingh-Git/ctxlock/code-scanning/alerts --jq 'length'`.
  - Record the real numbers in the guide and the journey chapter.
  - This repository's `ctxlock.yaml` ignores the fixtures, so a count of 0 is plausible and is still a real upload. Say so if it is.
  - No branch or pull request is created (D19), so the pull-request side is not checked live. Say so.

- [ ] **Step 3: Decisions:**
  - D133: SARIF comes from `lint`, not `diff`, and the gate stays with `diff`.
  - D134: alert identity is `diff`'s key plus an occurrence count.
  - D135: file-less findings are left out of the SARIF.
  - D136: a push with `sarif` uploads without a `diff`.

  Then write the journey chapter.

- [ ] **Step 4: `npm run ci`, commit and push.** Commit `docs: code scanning with ctxlock, and a live upload from this repository`.
