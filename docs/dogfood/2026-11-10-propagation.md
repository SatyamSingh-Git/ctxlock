# Dogfood: propagation, live

**Date:** 2026-11-10 · **Where:** `F:/ctxlock-live/propagation/`, three local git repositories · **Plan:** [Plan 6](../superpowers/plans/2026-11-10-ctxlock-propagation.md)

**Question:** can an org repository's skill and rule reach two repositories that use it, pinned, and does a change to one of them name exactly the repository it reaches? That is the multi-repository part of the spec's Phase 2 exit criterion. Local repositories are enough for it (D75).

**Answer:** yes.
- **Sync:** it brought each consumer exactly the units it declared, filled the skill for Claude Code, left the skill's hook behind, and pinned it all in `ctxlock.lock`.
- **Impact:** an upstream edit to the rule named only the consumer that takes it.
- **The second sync:** it updated that consumer. `diff` showed the change, and `L16` was clean.
- **A hand edit:** it gave an `L16` `must` and a sync refusal that wrote nothing.
- **One problem, found and fixed:** a consumer whose units hadn't changed still got a new commit in its lock.

## The repositories

- **`org`** has:
  - a skill, `.agents/skills/release`, marked `certified` in its `ctxlock.yaml`, with a `hooks/pre-release.sh` inside;
  - a rule, `.claude/rules/deps.md`, scoped to `package.json`;
  - its own `AGENTS.md`.
- **`payments`** takes the skill and the rule, with `repo: ../org`.
- **`web`** takes the skill only.

## What happened

**First sync, both consumers.** Payments got both units. Web got the skill only:

```
ctxlock sync

Upstreams:
  platform  main  a6f8b47

Added:
  .agents/skills/release  from platform
  .claude/rules/deps.md   from platform

Filled, so every agent loads it:
  .claude/skills/release/SKILL.md

Not synced:
  .agents/skills/release/hooks/pre-release.sh  hooks never sync
```

The lock recorded the skill's tier as `certified`, from the org's `ctxlock.yaml`, and the rule's as `reviewed`.

**An upstream edit to the rule, then `impact` in the org repository:**

```
$ ctxlock impact --base HEAD~1 --locks ../payments ../web
ctxlock impact

Changed:
  .claude/rules/deps.md  modified

Pinned by other repositories:
  F:\ctxlock-live\propagation\payments  .claude/rules/deps.md  at sha256:ec19be6a27ff  from platform
```

Web pins the skill, not the rule, so it wasn't named.

**The second sync, in payments.** Its markdown, the body the workflow would put on the pull request:

```
### ctxlock · sync

| Upstream | Ref | Commit |
|---|---|---|
| `platform` | `main` | `a6f8b47` → `9f36a0d` |

#### Changes

| Unit | Upstream | Change | Digest |
|---|---|---|---|
| `.claude/rules/deps.md` | `platform` | updated | `sha256:ec19be6a27ff` → `sha256:c165e1b68ba9` |
```

`ctxlock diff --base HEAD~1` then listed `modified rule/.claude/rules/deps.md`, with no new finding, and `lint` gave no `L16` finding.

**A hand edit in payments.** A line was added to the synced rule:

```
must    L16-lock      .claude/rules/deps.md            .claude/rules/deps.md differs from ctxlock.lock (synced from platform at 9f36a0d); change it upstream, or remove it from upstream units
```

Sync refused and exited 1:

```
Refused, so nothing was written:
  .claude/rules/deps.md  edited since the last sync
```

The org then changed the rule again. Sync still refused, and `git status` showed only the person's own edit.

## What broke

**Web's lock moved though nothing it takes had changed.**
- **What happened:** after the rule edit, web's sync said "Nothing changed." Yet it rewrote `ctxlock.lock`, with the org's new commit.
- **Why it matters:** the workflow would open a pull request that changes only a hash, in every consumer, for every org commit. People would learn to merge those without looking, which is what the lock exists to prevent.
- **The fix:** when none of an upstream's units, files or tiers have changed, sync now keeps the commit the lock already has. The files are identical at both commits, so the old pin is still true. Rerun, web's sync wrote nothing.

## What wasn't checked

- **The workflow on GitHub.** Its shell steps were tested against a stand-in for `gh` and a bare git remote. A run on GitHub needs Satyam's OK for each repository and pull request (D75).
- **A URL upstream over the network.** The fetch tests use local repositories. `git clone` treats a URL and a path alike, but no network fetch was tried here.
