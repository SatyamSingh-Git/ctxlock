# Suppressions, audited exceptions and unused ignores: design

Status: approved by Satyam on 2026-11-27. Satyam chose option C and the single-filter approach on 2026-11-24. Everything marked "my call" is the author's and open to correction. A builder check raised five gaps, settled here as my calls:
- `check`'s verdict;
- rule ids checked by syntax;
- `fingerprint` for safety exceptions;
- no severity for L18;
- `L14-generated` never inline.

## Why

The risk report's Now 4 is adopter trust: remove the noise and upkeep objections before people meet them. When ctxlock flags something a team has decided is fine, it gives them two blunt tools today: turn the rule `off`, or list whole files under `lint.ignore`. Both are repo-wide and silent, and nothing says who decided or until when. So teams turn rules off, and the checks that matter go with them.

Competitors' trackers show the same complaint: no scoped suppression (Cisco skill-scanner #222), and ignores that outlive the problem (zizmor #2525). The report asks for three things:
- an inline suppression with a required reason, exempt from `L1-html-comment`;
- audited exceptions, with owner, reason and expiry, judged by the base branch's config;
- a report of unused ignores.

## Goals

- **Inline suppression for quality rules.** A one-line HTML comment in a markdown context file quiets one or more named rules, for the next line or the whole file, with a required reason.
- **Audited exceptions for any rule**, in `ctxlock.yaml` under `lint.exceptions`, each with rule, path, owner, reason and expiry. In `diff` they come from the base branch, with the rest of `lint` (D30). After the expiry date the finding comes back, along with a `should` that says the exception lapsed.
- **Nothing is quieted unseen.** Every suppression and exception that quiets something is listed as an `info` finding with its reason, so it shows in `lint` output and, when new, in the pull request comment.
- **Unused ignores are reported.** An inline suppression, an exception or a `lint.ignore` pattern that quieted nothing in this run is a `should`.

## Non-goals

- A baseline file that records today's findings. `diff` already fails only on new ones.
- Suppressing `diff`'s execution-affecting changes (`L2-exec-config-changed`). Those are fingerprints, already controlled by that rule's severity.
- Per-user or machine-local suppressions. Google found that per-user configuration led to declining use (CACM 2018); everything here is committed.
- Suppression syntax for JSON, TOML or YAML files. Quality findings land on markdown. Findings on `ctxlock.yaml` or Ossie files use exceptions.

## Anti-goals

- **A pull request that excuses itself on a safety rule.** A PR that adds a hidden character and a comment saying it is fine must still fail.
- **A suppression that hides text from reviewers.** The directive is an HTML comment, which rendered markdown hides, so its reason must surface in ctxlock's own output.
- **`check` honouring a stranger's suppressions.** Its verdict must not move.

## Approaches

- **A. One filter in `runLint` (chosen).** `runLint` already applies `severity` and `lint.ignore`, and every command goes through it (`scan`, `lint`, `diff`, the Action and `check`). Suppressions and exceptions go in the same place, so no command can disagree with another.
- B. A filter in each command. Rejected: the copies would drift. A safety exception honoured by one command and not another is the kind of hole Plan 15's review found.
- C. A baseline file (Semgrep, PHPStan). Rejected: `diff` already fails only on new findings, and a baseline carries no owner, reason or expiry.

## Design

### Which rules can be suppressed inline

Option C, as Satyam chose:
- **Never inline:** every `L0-`, `L1-` and `L2-` rule. Those can only be excepted in `ctxlock.yaml`, judged from the base.
- **Also never inline: `L16-lock` and `L14-generated`.** My call: a directive added to a synced or generated file is itself a hand edit to that file, so it would excuse its own drift.
- **Never at all: `L18-`.** These rules report on suppression itself (below).
- **Every other rule can be suppressed inline**, including the `agnix:` ones.

### Inline syntax

Two forms, each one line, in a markdown context file (a unit, or a file of a skill):

```markdown
<!-- ctxlock-ignore-next-line L9-stale: the script is added by the release job -->
<!-- ctxlock-ignore-file L5-instruction-count L6-skill-length: generated from the API spec -->
```

- **Grammar** (strict, my call): `<!--`, spaces, `ctxlock-ignore-next-line` or `ctxlock-ignore-file`, one or more rule ids separated by spaces, a colon, a reason, spaces, `-->`.
  - A rule id is exact, with no globs. Its syntax is `L<number>-<lowercase words>` or `agnix:<id>`.
  - The reason is 1–200 characters on the same line, with no `-->` in it.
- **Rule ids are checked by syntax, not by whether the rule exists** (my call). A directive is still valid when it names a rule this version of ctxlock does not have, so a repository written for a newer ctxlock, or naming a renamed rule, does not suddenly fail. An id ctxlock does not know is reported as `L18-unused`, with a message that says so.
  - Known ids are a static list in `src/lint/`, covering every id the rules emit, including `L2-exec-config-changed` from `diff`.
  - `agnix:` ids are always valid. A directive or exception naming only `agnix:` rules is never `L18-unused` in a run where agnix did not run.
- **`next-line`** quiets findings of the named rules whose `line` is the first non-blank line after the directive.
- **`file`** quiets every finding of the named rules whose `path` is this file, with or without a line. It may sit anywhere in the body; frontmatter is YAML, so not there.
- **Only comments outside code count**, found exactly as `L1-html-comment` finds them (markdown-it, CommonMark). A directive in a code block or inline code is documentation, not a directive.
- **A malformed directive is not a directive**, and it is not exempt from `L1-html-comment`, which reports it as usual. That covers a missing reason, an unknown rule id, a rule that cannot be suppressed inline, a multi-line comment, or a reason over 200 characters. So a hostile `<!-- ctxlock-ignore-file L1-hidden-unicode: fine -->` gains nothing and is itself a must.
- **A valid directive is exempt from `L1-html-comment`, but only where suppressions are honoured.** It still counts for `L1-hidden-unicode` and `L2-risky-instruction`, which read the whole text.
  - `scanRepo` takes a new option, `suppressions` (default `true`). With `false`, no directive or exception applies, and no directive is exempt from `L1-html-comment`.
  - `check` passes `false`. That keeps its verdict exactly where it is today: a stranger's directive is hidden text, like any other comment. This corrects "check needs no change" below.
  - Where suppressions are honoured (your own repository, in `lint`, `scan` and `diff`), every directive's reason is quoted in its L18 finding. That is the visible place for text the rendered file hides.

### Exceptions in `ctxlock.yaml`

```yaml
lint:
  exceptions:
    - rule: L1-html-comment
      path: docs/AGENTS.md
      fingerprint: sha256:3f2a…      # this one comment; from `ctxlock lint --format json`
      owner: "@platform"
      reason: The license header our lawyers require
      expires: 2027-03-01
```

- **`rule`** is exact.
- **`path`** is an exact repository path. My call: no globs. An exception is meant to be one decision about one file.
- **How narrowly an exception matches** (my call). Each exception may give a `fingerprint` or a `match`; the safety rules require one.
  - `fingerprint` must equal the finding's `data.fingerprint`. `L1-hidden-unicode` (per run of characters), `L1-html-comment` (per comment) and `L2-exec-config` already carry one, and it does not move when lines do.
  - `match` is a substring that must appear in the finding's message.
  - `L1-` exceptions require `fingerprint`, because their messages give only a code point and position, or a comment's first 60 characters, which a second hidden thing could share.
  - Other `L0-` and `L2-` exceptions require one of the two.
  - Either is optional for the rest.
  - The point: an exception for one known hidden thing must not also cover the next one a pull request adds to that file.
  - `ctxlock lint`'s text output does not print fingerprints; the guide points to `--format json`.
- **`owner`, `reason` and `expires` (`YYYY-MM-DD`) are required.** A missing one, or a date that does not parse, makes `ctxlock.yaml` invalid (exit 2), as any schema error does today.
- **An exception applies while `today <= expires`**, using the same `today` that L10 uses for `stale-after`. After that the finding comes back. One `should`, `L18-exception-expired`, names the rule, path, owner and date.
- **`diff` uses the base branch's exceptions.** It already passes `settings: base.registry`, and exceptions live inside `lint`. A pull request can add an exception, but it applies only once merged, as a CODEOWNERS change does.

### Surfacing and unused

The new rule family is `L18`. Every finding has a `path`, and a `line` where there is one:

| Rule | Severity | When |
|---|---|---|
| `L18-suppressed` | info | A directive or exception that quieted at least one finding. The message says what it quieted, how many, and its reason; for an exception also its owner and expiry. Path and line are the directive's, or the excepted file for an exception |
| `L18-unused` | should | A valid directive, an exception or a `lint.ignore` pattern that quieted nothing in this run. For `lint.ignore` and exceptions the path is `ctxlock.yaml` |
| `L18-exception-expired` | should | An exception past its date. Its finding is back |

- **The filtering order** is `severity` (including `off`), then exceptions, then inline directives, then `lint.ignore`.
  - A finding quieted by an earlier step does not count as used by a later one.
  - My call, on a rule switched `off`: an exception for it is unused, because the `off` already quiets it.
- **L18 findings themselves** cannot be suppressed or excepted, and `lint.ignore` does not drop them. Otherwise an ignore of `**` would hide its own unused report.
  - `lint.severity` cannot name an `L18-` rule: that is a `ctxlock.yaml` error (exit 2). Otherwise `L18-suppressed: off` would quiet things unseen. Neither `should` fails `lint`, so nothing forces a team to fight them.
- **In `diff`**, a new `L18-suppressed` is a new info finding, so the pull request comment lists the suppression and its reason. That is how a reviewer sees text the rendered file hides.

### `check`

One change: it scans with `suppressions: false` (above). Then:
- `DEFAULTS` has no exceptions.
- No directive applies or is exempt, so every `ctxlock-ignore` comment in a stranger's repository is an `L1-html-comment` must there, exactly as today.
- It still reports only `L0`, `L1` and `L2`.

## Constraints

- No new dependency. Directive finding reuses `L1-html-comment`'s markdown-it comment scan, exported from `src/lint/rules/l1-hidden.ts` rather than copied.
- `ctxlock.yaml` stays `version: 1`. `lint.exceptions` is optional and defaults to `[]`.
- JSON output keeps its shape: L18 findings are ordinary findings.

## Left to the builder

- Where the directive parser and the matching live inside `src/lint/` (a new `src/lint/suppress.ts` is the obvious place).
- The exact message wording of the three L18 rules, as long as it carries the facts listed above.
- The docs:
  - `the-guide/configuration.md` (`lint.exceptions`);
  - `the-guide/rules.md` (L18, and the directive exemption under `L1-html-comment`);
  - a short "quieting a finding" section, probably in `rules.md`;
  - journey chapter 22 and the decisions.
