# Business context: knowledge and metric units

Agents answer questions about your business, not only your code: what net revenue retention means, how pricing works, which table holds a number. ctxlock treats that context the way it treats a skill or a rule. It is a unit with a digest, an owner and trust dates. It is checked against its own format, placed in the graph, synced from an upstream and probed.

There are two kinds, each in an open format ctxlock doesn't change:

| Kind | Format | One unit is |
|---|---|---|
| `knowledge` | [OKF 0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf), Google's Open Knowledge Format: Markdown with YAML frontmatter | one concept, a `.md` file in a bundle |
| `metric` | [Apache Ossie 0.3.0.dev0](https://github.com/apache/ossie), a semantic model in YAML or JSON | one model file |

An agent operating procedure is an [Agent Skill](https://agentskills.io), which ctxlock already handles as a `skill`.

No agent loads these files on its own the way Claude Code loads `CLAUDE.md`. So they never count toward an agent's budget, and `build` leaves them alone. An agent reads them when a task sends it there. An MCP server that serves them is the next part of the plan.

## Which files are units

**Knowledge.** Every `.md` in a bundle is a concept, except `index.md` and `log.md`, which OKF reserves. A folder is a bundle when:
- its `index.md` declares `okf_version` in its frontmatter, the way OKF lets a bundle say what it is; or
- `ctxlock.yaml` names it:

```yaml
version: 1
knowledge: [docs/kb, okf/bundles/acme_retail]
```

Google's own sample bundles don't declare `okf_version`, so naming the folder is the usual way. A docs folder whose pages carry `type:` in their frontmatter, as Hugo and Jekyll pages do, is never read as knowledge unless you name it.

**Metrics.** A file named `*.ossie.yaml`, `*.ossie.yml` or `*.ossie.json` is a model. So is any file `ctxlock.yaml` names, or any `.yaml`, `.yml` or `.json` file in a folder it names:

```yaml
metrics: [examples/tpcds_semantic_model.yaml, semantic/]
```

**Synced units.** A unit `ctxlock sync` brought in is the kind its upstream said, as recorded in `ctxlock.lock`. The consumer declares nothing.

A rule, skill or instructions file inside a bundle stays what it is.

**Paths are from the repository's root.** ctxlock reads the whole git repository a folder is in, so `ctxlock.yaml` sits at the root of the repository, even when you scan a folder inside it.

## What lint checks

[`L17-format`](rules.md#l17-business-context-in-its-own-format):
- **A concept:** it needs a non-empty `type`, a `status` of `draft`, `stable` or `deprecated`, and times with an offset.
- **A model:** it is checked against Ossie's own JSON Schema. A model written for another Ossie draft gets one finding naming both versions.

The other rules that read text, such as hidden Unicode (`L1`) and stale paths (`L9`), read a concept like any Markdown. A model's YAML isn't read as Markdown, but its `stale-after` is still checked.

## Trust dates

OKF puts trust in the concept itself:

```yaml
verified: { by: human:finance, at: 2026-11-01T09:00:00Z }
stale_after: 2027-02-01T00:00:00Z
```

ctxlock reads them as the concept's `verified-at` and `stale-after`, so `lint`, `verify` and `outcomes` use them with nothing in `ctxlock.yaml`:
- **`verified-at`:** the UTC date of the latest `verified` time. A bare `verified` mapping counts as a list of one.
- **`stale-after`:** OKF's `stale_after` is the instant a concept turns stale, and ctxlock's `stale-after` is the last day it is still good. So `2027-02-01T00:00:00Z` becomes `2027-01-31`, and lint flags the concept from 1 February, as OKF does. A `stale_after` later in a day is flagged from the next day.

A time without an offset fills nothing, and `L17-format` reports it.

**`ctxlock.yaml` wins** when both are set (§4.1 of the design), and `L17-trust-differs` says when they disagree. An Ossie model has no trust fields of its own, so its owner and dates live in `ctxlock.yaml`.

## In the graph

A concept's links are its record of what it rests on. A link from a concept to another unit, such as `[the revenue model](../models/revenue.ossie.yaml)`, is a `depends-on` edge, beside any you declare. A link through a symlink reaches the unit behind it. So `impact` on a change to the model reaches the concepts that cite it, and `who-uses` names them:

```
ctxlock who-uses · models/revenue.ossie.yaml

Units that depend on it:
  kb/nrr.md

No configured agent loads it.
```

Links to URLs, to anchors, or to files that are no unit add nothing.

## Probes that check an answer

An agent uses business context to say something, not to run a command. A probe can expect an answer: a regular expression tested against the agent's final reply, ignoring case. The reply is used for grading and never printed.

```yaml
version: 1
probes:
  - id: nrr-by-segment
    unit: knowledge/kb/nrr.md
    prompt: From the revenue model and the knowledge files in this repository, which field do I group net revenue retention by to see it per customer segment? Answer in one line, naming the dataset and the field.
    expect:
      answer: 'customers\.segment'
```

**Write the pattern so only the right answer matches.** In the live run, the replies without the segment field correctly said there was none, and one of the three still matched `customers\.segment`, most likely by naming it as the field to add. Where a wrong answer can name the right thing, pair the probe with a `not: true` probe for the wrong one, or match a phrase only the right answer uses.

## Sync

Under `upstream:`, a concept or a model syncs as one file, as a rule does. It is pinned in `ctxlock.lock`, a hand edit is refused and flagged by `L16-lock`, and the consumer finds it as its kind ([propagation](propagation.md)).

## Format versions

These formats are young. Ossie 0.3.0.dev0 is a draft, and it renamed `custom_extensions` to `nonportable_extensions` on 2026-11-10. ctxlock vendors Ossie's schema at one commit, `1b1ebb6`, and says so when a model names another version.
