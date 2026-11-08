# The graph: what relies on what

A rule your release skill relies on changes. Who should look at that pull request, and which probes should run? Nothing in the files says so: AGENTS.md, skills and rules don't name what they rely on. `ctxlock.yaml` can, and ctxlock then answers three questions:
- what relies on a unit (`ctxlock who-uses`);
- what a change reaches, and whose approval it needs (`ctxlock impact`, and the pull request comment);
- which probes a change should run (`ctxlock eval`).

> **Status:** implemented and tested, within one repository. Loads seen in real sessions, and the org context repository that carries changes to other repositories, come later.

## Declaring it

```yaml
version: 1
units:
  .claude/rules/testing.md:
    depends-on: [.claude/rules/deps.md]
  .agents/skills/release:
    depends-on: [.claude/rules/testing.md@reviewed]
consumers:
  payments-api:
    owner: "@payments-team"
    depends-on: [.agents/skills/release]
    evals: [evals/probes/payments.yaml]
```

- **`depends-on`** lists the units this one relies on.
  - Each entry is a unit's path, as the `units:` keys are, or its ID, as `ctxlock scan` and probes show it (`rule/.claude/rules/deps.md`).
  - A symlinked copy of a skill names the same unit.
  - `@<tier>` says the least trust it needs. A unit with no `tier` counts as `reviewed`.
- **A consumer** is an agent configuration that uses units. For a coding team it is usually this repository, run with the agents its developers use. Its fields are in [configuration](configuration.md#fields).

[`L15-graph`](rules.md#l15-graph-should) reports a reference that names no unit, such as one left behind by a rename. It also reports a tier that is not met, and an `evals` path that holds no probe file.

## What relies on a unit

```
$ ctxlock who-uses .claude/rules/deps.md
ctxlock who-uses · .claude/rules/deps.md

Units that depend on it:
  .claude/rules/testing.md
  .agents/skills/release    through .claude/rules/testing.md

Consumers:
  payments-api  @payments-team  production  through .agents/skills/release, .claude/rules/testing.md

Loaded by (predicted):
  claude-code  .  always
```

"Through" is the shortest chain of `depends-on` from that unit down to the one you asked about. "Loaded by" comes from ctxlock's model of how each agent loads context, the same one `ctxlock budget` uses. It is a prediction, not something seen in a session. `who-uses` also lists the files [`ctxlock build`](build.md) generated from the unit.

## What a change reaches

```
$ ctxlock impact --base origin/main
ctxlock impact

Changed:
  .claude/rules/deps.md  modified

Depends on what changed:
  .claude/rules/testing.md
  .agents/skills/release    through .claude/rules/testing.md

Consumers:
  payments-api  @payments-team  production  through .agents/skills/release, .claude/rules/testing.md

Owners to ask: @payments-team, @platform-team
```

The owners are those of each changed unit, from `ctxlock.yaml` or CODEOWNERS, and of each consumer reached. All of it is read from both refs. A change that also deletes an edge still reaches what relied on the unit before it, and a change that rewrites CODEOWNERS or an `owner` still asks the owners the base names, as GitHub does.

The same section, `#### Impact`, appears in the pull request comment of [the GitHub Action](github-action.md) whenever a change reaches a unit or a consumer. Every name in it is shown as code, so the comment notifies no one. Impact never fails a check: it tells reviewers where to look.

## Which probes run

`ctxlock eval` runs a probe when the change reaches it:
- its unit changed;
- its unit depends on a changed unit;
- or its file is under the `evals` of a consumer the change reaches.

The report says which of the last two applied ([evals](evals.md)).
