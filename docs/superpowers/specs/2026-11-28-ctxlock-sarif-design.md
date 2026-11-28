# SARIF output: design

Status: draft for Satyam's approval. On 2026-11-28 Satyam chose:
- approach A: ctxlock writes the file, and the Action uploads it only when asked;
- the single-renderer build.

Everything marked "my call" is the author's.

## Why

Developers already look in two places: GitHub's code-scanning alerts and pull request annotations, and VS Code's Problems panel through the SARIF viewer. ctxlock findings appear in neither, because ctxlock writes only text, JSON and markdown. The risk report lists SARIF among the basics its competitors miss, and the adopter-trust work (Now 4) names it next.

## Goals

- **`ctxlock lint --format sarif`** writes one SARIF 2.1.0 log of the findings `lint` reports, after suppressions: one run, tool `ctxlock`.
- **The Action gains an input, `sarif`**, which defaults to `'false'`. With `'true'`, after the check it runs `lint --format sarif` on the workspace and uploads the file with `github/codeql-action/upload-sarif@v4`, category `ctxlock`.
- **Code scanning keeps one alert per finding across commits**: a finding that moves down a few lines is the same alert.

## Non-goals

- Changing the pull request comment or the pass/fail gate. Both stay with `diff`, judged from the base branch.
- `diff`, `check` or `scan` emitting SARIF. Code scanning does its own new-versus-fixed tracking, so it wants every finding on the branch, which is `lint`'s output.
- Uploading through the REST API or any service other than GitHub.

## Anti-goals

- **Breaking a workflow that did not ask for SARIF.** The default is off.
- **Failing the check because an upload failed.** Pull requests from forks get a read-only token, and private repositories need GitHub Code Security. The upload step continues on error, and a warning says why.
- **Letting SARIF move the gate.** The SARIF comes from `lint` on the pull request's head, so it uses the head's `ctxlock.yaml`. That only changes which alerts show, never whether the check passes.

## Approaches

- **A. A renderer next to the others (chosen).** `src/report/sarif.ts`, about 60 lines of plain JSON.
- B. A SARIF library, such as node-sarif-builder. Rejected: a dependency for plain JSON.
- C. Converting `--format json` inside the Action with a shell step. Rejected: untested, drifts from the CLI, and gives nothing for VS Code locally.

## Design

`src/report/sarif.ts` exports `renderSarif(findings: Finding[], version: string): string`. The log is 2.1.0, with `$schema` `https://json.schemastore.org/sarif-2.1.0.json`.
- **`tool.driver`:** name `ctxlock`, the package version, `informationUri` the repository URL. `rules` holds one entry per rule id that appears, each with:
  - `id`;
  - `helpUri`: `https://github.com/SatyamSingh-Git/ctxlock/blob/main/the-guide/rules.md`, with no per-rule anchor (my call: the headings carry severities, so anchors are fragile);
  - `defaultConfiguration.level` from the rule's first finding.
- **Each finding becomes one result:**
  - `ruleId` is the rule;
  - `level` is `error` for must, `warning` for should and `note` for info;
  - `message.text` is the message;
  - one location, with `artifactLocation.uri` set to the path and `uriBaseId` `%SRCROOT%`;
  - `region.startLine` and `startColumn` when the finding has them, else `startLine` 1.
- **Findings with no path** go on `ctxlock.yaml`, line 1 (my call). Code scanning drops a result that has no location. These are few: L10's "no owners" summary, and `agnix:unavailable`.
- **`partialFingerprints`:** `{ "ctxlock/v1": <sha256 of diff's matching key> }`. That key is rule, unit or path, and fingerprint or message with numbers removed: the one `diff` already uses to decide what is new. So an alert survives line moves exactly when `diff` would call the finding old.
  - My call: reuse `diff.ts`'s `key`, exported, not a copy.
- **Message text goes through no `printable`.** SARIF is JSON, so control characters are escaped by `JSON.stringify`, and viewers render text, not terminal escapes.
- **Output:** `lint --format sarif` prints the log to stdout. Exit codes are unchanged (1 on a must).

`action.yml`:
- **The new input:** `sarif`, description "Upload lint's findings to GitHub code scanning. The workflow needs `security-events: write`."
- **A step "Write SARIF"** (if `inputs.sarif == 'true'`, always) runs `lint --format sarif "$GITHUB_WORKSPACE" > "$RUNNER_TEMP/ctxlock.sarif"`. Exit 1 is expected; only a missing or empty file is a problem.
- **A step "Upload SARIF"** (same condition, `continue-on-error: true`) uses `github/codeql-action/upload-sarif@v4` with `sarif_file` and `category: ctxlock`.
- **A step "SARIF upload warning"** prints a `::warning::` naming the two usual causes (a fork's read-only token, or a private repository without Code Security) when the upload step's outcome is `failure`.
- **The Result step is unchanged.** It still decides pass or fail from `diff`.

## Constraints

- No new runtime dependency.
- The SARIF must validate against the 2.1.0 schema. A test checks the required properties and shape, without fetching the schema.
- The upload action is pinned by major tag, `@v4`, as the Action pins its other actions.

## Left to the builder

- The docs:
  - `the-guide/github-action.md`, with the input, the permission and the fork/private caveat;
  - `the-guide/commands.md` (`--format sarif` under lint);
  - a README line;
  - a decision row and a journey chapter.
- A live check: upload once from this repository's `self-test` workflow with `sarif: true` and `security-events: write`. The repository is public, so code scanning is free there. Record what GitHub shows.
