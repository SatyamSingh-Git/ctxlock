# 22. Quieting a finding, with a reason

The second part of Now 4, adopter trust ([design](../docs/superpowers/specs/2026-11-24-ctxlock-suppressions-design.md), [plan](../docs/superpowers/plans/2026-11-27-ctxlock-suppressions.md)).

Until now, a team that disagreed with a finding had two blunt tools: turn the rule `off`, or ignore whole paths. Neither said who decided, or until when, and both took every other finding of that rule or file with them. That is how a team ends up switching off the checks that matter.

Satyam chose option C on 2026-11-24 and approved the design on 2026-11-27. Under C, a pull request may quiet a quality rule in the file itself, but never a safety rule. The rest were my calls, D126 to D130.

## What exists now

- **Inline directives.** `<!-- ctxlock-ignore-next-line L5-instruction-count: reason -->` and `ctxlock-ignore-file` quiet quality rules in a markdown file. A directive in a code block is an example, not a directive.
- **Exceptions.** `lint.exceptions` in `ctxlock.yaml` takes a rule, an exact path, an owner, a reason and an expiry. A safety exception must name its one finding: by fingerprint for L1, and by fingerprint or message text for L0 and L2. In `diff`, exceptions come from the base branch.
- **L18 reports.** Every quieting is listed as an `L18-suppressed` info with its reason. Every directive, exception or `lint.ignore` pattern that quiets nothing is an `L18-unused` should, and a lapsed exception is an `L18-exception-expired` should.
- **`check` honours none of it.** A stranger's directive is reported as the hidden comment it is.
- **This repository now has a `ctxlock.yaml`.** It ignores `spikes/**` and `tests/fixtures/**`, which hold other projects' context copied in for tests. `ctxlock lint .` reports no findings.

## What went wrong, and was caught

- **The builder check found a hole before any code was written.** Exempting directives from `L1-html-comment` would have changed `check`'s verdict on someone else's repository: 200 characters of hidden text would have stopped counting. `check` now scans with suppressions off (D130).
- **A message-text match is too weak for L1.** Its messages give only a code point and a position, so an exception matching "U+200B" would also have excused the next one a pull request added to the same file. L1 exceptions now need the finding's fingerprint (D128).
- **A test of mine was wrong, not the code.** The first mutation run showed every mutant killing exactly two tests. That pointed to a test failing on the unmutated code: I had expected the L18 lines in the order they are added, but lint sorts warnings before info. The baseline is now checked before every mutation run.
- **Dogfooding changed the plan.** I first gave this repository three exceptions for the OKF fixtures' attribution comments. But a `ctxlock.yaml` also turns on `L10-owner`, which added eleven warnings for fixtures. `lint.ignore` is the honest tool for test data, so the exceptions went.
- **The final review found three ways around the promises, each reproduced end to end, and all fixed:**
  - The directive grammar backtracked exponentially. A directive missing its colon took 65 seconds, so a stranger's upstream could hang `sync`.
  - A directive naming only `agnix:` rules hid its reason with no finding at all, on every run without agnix.
  - A base exception for one hidden character also excused a second identical one (D131).

  It also found that the guide's lead example, quieting `L5-instruction-count`, could never work: L5 findings had no file (D132).
