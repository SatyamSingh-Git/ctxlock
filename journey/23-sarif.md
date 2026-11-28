# 23. Findings where developers already look

The third part of Now 4, adopter trust ([design](../docs/superpowers/specs/2026-11-28-ctxlock-sarif-design.md), [plan](../docs/superpowers/plans/2026-11-28-ctxlock-sarif.md)).

ctxlock's findings lived in its own output and in one pull request comment. Developers look at two other places: GitHub's code-scanning alerts with their annotations on changed lines, and VS Code's Problems panel through the SARIF Viewer. SARIF reaches both. Satyam chose approach A on 2026-11-28: ctxlock writes the file, and the Action uploads it only when asked. The rest were my calls, D133 to D136.

## What exists now

- **`ctxlock lint --format sarif`** writes a SARIF 2.1.0 log. Must is `error`, should is `warning` and info is `note`.
  - Each alert keeps `diff`'s idea of "the same finding", so a moved finding stays one alert.
  - A finding with no file in the repository is left out.
- **The Action's `sarif: 'true'`** uploads that log with `upload-sarif@v4`, category `ctxlock`. A failed upload warns and does not fail the check.
  - A push to main with `sarif` on and no base is code scanning's analysis of the branch: the Action uploads, and skips the diff.
- **This repository's `self-test` workflow uploads on every pull request and every push to main.** The first upload, on 2026-11-28, made an analysis with 0 results, because `ctxlock lint .` is clean here.

## What went wrong, and was caught

- **A builder check found the plan's fingerprint field did nothing.** The draft put ctxlock's key under its own name in `partialFingerprints`. GitHub asks for its own field, `primaryLocationLineHash`, which `upload-sarif` fills only when it is missing, so the key moved there. A third-party page says GitHub reads no other field; GitHub's own docs do not say so.
- **It also found the default-branch gap.** Without an analysis of main, every pull request would have shown every old finding as new. The Action now uploads on pushes (D136).
- **A mutation survived because the test harness was not GitHub.** GitHub runs a bash step with `-e` and `pipefail`, and the old helper ran plain `bash -c`. So a Write SARIF step that stopped on lint's exit 1 passed the tests. The new helper runs steps as GitHub does.
- **A shell quoting mistake of mine ran text as commands.** A documentation edit passed through a shell string with backticks, and bash ran each backticked word. Nothing destructive ran, and the three files it touched were restored from git. Docs are now edited only with the editor tool.
- **Not checked live:** the pull-request side (annotations on changed lines), since no branch was made (D19). Nor has GitHub yet processed an upload with results: this repository's analysis has none.
