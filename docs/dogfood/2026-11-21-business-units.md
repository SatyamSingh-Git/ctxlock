# Dogfood: knowledge and metric units, live

**Date:** 2026-11-21. **Build:** ctxlock at 03dd31f (Plan 11, Tasks 1–6). **Agent:** Claude Code 2.1.319 on claude-sonnet-5-5.

**Questions:**
- Do the formats' own published examples read as units and pass `L17-format`?
- Does the NRR-by-segment change work end to end: lint, the graph, a probe on the answer, and sync to a consumer?

## Results

- **Google's OKF sample bundles:** 53 concepts in 4 bundles, all units. 0 L17 findings.
- **Apache Ossie's own models:** 22 models, 19 found by their `*.ossie.yaml` names and 3 examples declared. 0 L17 findings.
- **NRR by segment:**
  - lint is clean;
  - `who-uses` on the model names the concept that links to it;
  - the answer probe went from base 1/3 to head 3/3, improved, in 46 s and 6 runs;
  - sync brought both units into a consumer as their kinds;
  - a hand edit there was refused (exit 1) and flagged `L16-lock` (`must`).

## The published examples

**OKF.** Google's `knowledge-catalog` repository at `6886cc6`, `okf/bundles`: acme_retail, crypto_bitcoin, ga4 and stackoverflow.
- **Finding: none of the four declares `okf_version`.** So naming the folder in `ctxlock.yaml` is the usual way to declare a bundle, not the fallback. The guide says so.
- **Finding: `ctxlock.yaml` must sit at the repository's root.** The first scan was of the `okf/bundles` folder, with `ctxlock.yaml` in it, and found no units. ctxlock reads the whole git repository a folder is in, a choice from Plan 1, so `ctxlock.yaml` is read at the root. With it there, naming the four folders by their paths from the root, `scan` found 53 knowledge units.
  - An independent count agrees: 78 Markdown files, 25 of them `index.md` or `log.md`, 53 concepts, every one with a `type`.
- Lint gave 0 L17 findings, and 53 `L10-owner` (no owner anywhere), as for any unit without one.

**Ossie.** `apache/ossie` at `1b1ebb6`, the commit the schema is vendored from:
- 19 files named `*.ossie.yaml`, from the compliance suites, were found with nothing declared;
- the three `examples/*semantic_model.yaml` files were named under `metrics:`;
- all 22 passed Ossie's schema, with no L17 finding.

## NRR by segment

The fixture is in `F:\ctxlock-live\business\nrr`:
- **`org`:** an upstream repository with:
  - an Ossie model `models/revenue.ossie.yaml`: `customers` (`customer_id`, `region`), `subscriptions` with an `nrr` metric, and a relationship between them;
  - an OKF concept `kb/nrr.md` that links to the model, with `verified` and `stale_after`;
  - an `answer` probe asking which field groups NRR per customer segment, expecting `customers\.segment`.
- **`web`:** a consumer that names both units under `upstream:`.

**Steps:**

| Step | What happened |
|---|---|
| `lint` on `org` | 0 must, 0 should. The only finding was `L10-owner` (info). |
| The change | The owner added a `segment` field to `customers`, and the sentence "NRR by segment groups by `customers.segment`." to the concept |
| `who-uses models/revenue.ossie.yaml` | "Units that depend on it: kb/nrr.md", from the concept's link alone |
| `eval --base HEAD`, 3 runs a side | `nrr-by-segment  knowledge/kb/nrr.md  base 1/3  head 3/3  improved`, 6 runs, 46 s, $0.14 notional |
| Commit, then `sync` in `web` | Both units added from `finance` at `c988705`. `scan` there lists `knowledge kb/nrr.md` and `metric models/revenue.ossie.yaml`, with nothing declared |
| A line added to `kb/nrr.md` in `web` | `L16-lock` `must`: "kb/nrr.md differs from ctxlock.lock (synced from finance at c988705)"; `sync` refused it and exited 1 |

**The one base run that passed.** Replies are never stored, so it was checked by asking the base side's question by hand twice. Both replies were right: "the `customers` dataset has no segment field". Neither matched. The passing run most likely named `customers.segment` as the field to add, which the pattern can't tell from naming it as the answer. The guide now says to write an answer pattern only the right answer matches, or to pair it with a `not: true` probe.

**Also seen:**
- **Synced units in `web` get `L10-owner`,** since their owner is declared upstream. Synced rules do the same: this predates the plan.
- **`impact` with both units changed** lists both as changed, and neither as the other's dependent. `who-uses` shows the edge.

## What is still open

- An agent finds these files only when the prompt sends it there. Plan 12 serves them over MCP, and runs eval with that server attached.
- The exit demo has feedback reach the metric's owner from an agent's own report of a gap, which is Plan 12's `report_context_gap`.
