# 21. Is this safe to open?

The risk report's "Now 4" was adopter trust. Satyam chose it on 2026-11-24 and approved the design for its first part: `ctxlock check <folder-or-git-url>` ([design](../docs/superpowers/specs/2026-11-24-ctxlock-check-design.md), [plan](../docs/superpowers/plans/2026-11-24-ctxlock-check.md)).

The person it is for is not a team with CI. It is someone alone, about to open a stranger's repository in an agent or install a skill from a marketplace. One command, no setup, says what would run and what is hidden ([guide](../the-guide/check.md)).

This plan ran alongside the Plan 14 session in the same working tree. The two sessions split the files between them, committed by name, and pushed only as fast-forwards.

## What exists now

- `check` reads a folder, or fetches a git URL into ctxlock's cache without a checkout, hooks or credentials.
- It reports what runs code when opened, per agent, the `must` findings of L0, L1 and L2, and their `should` findings as "worth a look".
- It exits 1 on anything listed, and its result never depends on the target's own `ctxlock.yaml` (D122).
- Every `SKILL.md` no agent already reads is checked as if installed (D123).

## What went wrong, and was caught

- **Credentials, twice.** The first version cleared the credential helper for every fetch. That would have broken `sync` of a developer's own private repository, so it became an option only `check` sets. Its test then hung for a minute under Git Bash on a terminal prompt, until the stub helper returned a username and the prompt was switched off.
- **A mutation found a hole.** With the target's `ctxlock.yaml` read as usual, a repository could switch L1 off and pass. `check` now scans with default settings.
- **The live check called a skills repository clean.** `anthropics/skills` holds 20 skills at `skills/<name>/SKILL.md`. No agent reads that path, so discovery found none, and `check` said nothing runs. It now reads them as installed skills, and finds two real spec violations there.
