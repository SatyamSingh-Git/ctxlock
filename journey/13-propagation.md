# 13. Propagation: one skill, many repositories, pinned

[Plan 6](../docs/superpowers/plans/2026-11-10-ctxlock-propagation.md) is Phase 2's third plan. Until now, ctxlock looked at one repository at a time. This plan lets an org repository's skills and rules reach the repositories that use them, pinned like a dependency, so a shared unit can't quietly drift.

Satyam asked to start the work without further design questions, so the open calls, D68 to D75, are mine, and are marked so.

## What exists now

- **`upstream:` in `ctxlock.yaml`** names each upstream, its `repo` and `ref`, and the units this repository takes from it (D69).
- **`ctxlock sync`:**
  - **Fetching:** it clones each upstream into ctxlock's cache with no hooks and no `ext::` transport, and resolves its ref.
  - **Writing:** each unit lands at its upstream path. Only skills and rules sync (D71), and inside a skill, hooks, settings and `.mcp.json` never do.
  - **Refusing:** it writes nothing, and exits 1, rather than overwrite a person's file or an edited synced one.
  - **Filling:** it fills what it brought in for the other agent.
- **`ctxlock.lock`**, in APM's shape (D70): each upstream's commit, and for each unit its digest, its tier upstream, and a digest per file.
- **`L16-lock`:** a synced file edited by hand, or missing, is a `must`; a stale lock entry is a `should`.
- **Tiers from the lock** (D72): a synced unit's tier is its owner's, and a consumer can't raise it.
- **`ctxlock impact --locks`** names the repositories whose lock pins a changed unit (D73).
- **`ctxlock report`** writes `loads`'s counts as JSON to share, with no session ID, local path, error message or credential in it (D74).
- **A workflow template** keeps one sync pull request open in each consumer, using that repository's own token (D68).
- **The suite** has 571 tests.

## What worked

**The pieces were already there.**
- **Reading an upstream at a commit:** Plan 1's `gitReader` does it, and `scanRepo` finds the units.
- **Digests:** unit digests and LF file digests came from Plan 3, so a CRLF checkout of a synced file is not an edit.
- **Filling for the other agent:** `build`'s fill does that.
- **Rules about overwriting:** D50's "never overwrite what ctxlock didn't write" applied unchanged. Sync applies it to whole files, refusing the entire sync rather than writing part of it.

**Mutation checks, task by task.** Each task's tests were checked by mutating the code they cover:

| Task | Killed |
|---|---|
| Sync engine | 14 of 14 |
| Sync CLI and renderer | 15 of 15 |
| `L16` | 7 of 8 |
| Tiers and `--locks` | 12 of 12 |
| The real-path fix | 3 of 3 |
| `report` | 9 of 9 |
| Workflow template | 8 of 8 |
| The kept-commit fix | 3 of 3 |

- **`L16`'s survivor** was a badly written mutant that changed nothing.
- **Two mutants survived a first run, and each got a test:** the order of writes, when units are declared in reverse; and `lint` seeing a broken lock through a scan.
- **Two more tests were written before running mutants that would plainly have survived:** a gap sync didn't bring in being left for `build`; and the workflow replacing a diverged `ctxlock/sync` branch from an earlier run.

**The live demo found what the tests couldn't.** It had an org repository and two consumers on disk ([report](../docs/dogfood/2026-11-10-propagation.md)). `impact --locks` named only the consumer that takes the edited rule, and a hand edit was refused by sync and flagged by `L16`.

## What broke

- **Windows CI, over 8.3 short names, again.**
  - **What happened:** `impact --locks` compared folder paths as text. On GitHub's Windows runner, the temp folder has a short name (`RUNNER~1`), while git reports the long one. So a lock naming the org by one name missed the repository known by the other.
  - **The fix:** `pinnedBy` now takes a real-path function, as `joinSessions` already did. A junction reproduced the failure locally.
  - **Why it hurts:** chapter 11 learned the same lesson, and new code repeated the mistake ([mistakes](mistakes.md)).
- **A lock that moved on every org commit.**
  - Found in the live demo: a consumer whose units hadn't changed still got the org's new commit in its lock, so the workflow would have opened a hash-only pull request everywhere.
  - Sync now keeps the old commit when nothing it pins has changed.
- **A gap in the plan.** Its Review Focus asked that a unit deleted upstream be removed, while D69 and its own exit-2 rule implied an error. The ruling: a declared unit missing upstream stops sync with exit 2, and removal happens only when the consumer drops it from `units:`. A silent removal would hide that the org deleted something a repository relies on.
- **YAML read a hand-written commit as a number.** A test lock had a commit of forty 1s, which YAML parses as a number. Real locks are safe: `serializeLock` quotes any string that would read as one.

## What was learned

- **Pull beats push for a context tool.** Each repository runs `sync` with its own token. No credential that can write to every repository exists anywhere. That is Dependabot's model, and §7 asks for no less.
- **A lock is only reviewed if it changes when something real changes.** A lock that moves on every upstream commit trains people to merge without reading. Keeping the pin when nothing pinned changed is what makes "every change arrives as a diff someone reviews" true in practice.
- **Lint and sync judge one file two ways.** Sync stops on a broken lock, since it can't safely act. Lint reports the same lock as a finding, since its job is to tell you, not to stop.
