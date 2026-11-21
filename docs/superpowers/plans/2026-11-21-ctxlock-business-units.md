# ctxlock: knowledge and metric units

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make business context a first-class unit, the same as a skill or a rule:
- **`knowledge`:** an OKF 0.2 concept, one Markdown file in a bundle.
- **`metric`:** an Apache Ossie 0.3.0.dev0 semantic model, one YAML or JSON file.

Each is discovered, digested, linted against its own format, given trust dates, placed in the graph, synced from an upstream, and checked by probes that grade the agent's answer.

**Architecture:**
- **Discovery:** finds the two kinds from folders and files `ctxlock.yaml` names, from the formats' own markers, and from `ctxlock.lock`, so a synced unit is the kind its upstream said.
- **`L17-format`:** OKF's conformance rules, and Ossie's own JSON Schema, vendored.
- **Trust:** OKF's `verified` and `stale_after` fill `verified-at` and `stale-after` where `ctxlock.yaml` has none. L9, `verify` and `outcomes` then read them with no change of their own.
- **Graph:** an OKF concept's links to other units become `depends-on` edges.
- **Sync:** the two kinds sync the way a rule does, as one file.
- **Probes:** gain `answer`, a regular expression over the agent's final reply.

**Tech Stack:** TypeScript 7, Node ≥ 22 ESM, vitest, zod 4, commander. One new runtime dependency: `ajv` 8 (MIT), for Ossie's draft 2020-12 schema.

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md):
- §4.1: `knowledge` (4) is "Google OKF Markdown (`type`, `sources`, `verified`, `stale_after`)", and `metric` (4) is "Apache Ossie semantic model YAML". The field names "line up with OKF's `verified`/`stale_after`".
- §6 Phase 4: "New unit kinds: `knowledge` (OKF), `metric` (Ossie), `procedure` (AOP skills)". The exit is "the keynote's NRR-by-segment example, end to end".

It builds on Plans 4 (the graph), 6 (sync) and 9 (`verify`). Satyam asked on 2026-11-21 to "continue the work" without design questions. Every call below that the spec leaves open is mine.

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

## Phase 4, split (D100)

Like Phase 3 (D77), Phase 4 is three plans:
- **Plan 11, this plan:** the units.
- **Plan 12:** an MCP server that serves them, with a `report_context_gap` tool whose reports reach `misses`, and eval runs that attach it.
- **Plan 13:** the read-only virtual filesystem with per-principal pruning, and the NRR-by-segment exit demo.

**`procedure` is a skill (D101).** The keynote said there is "no standard yet" for agent operating procedures, and the spec's own example is "An Agent Skill". Skills already are units, so nothing is added for it.

## The formats, as of 2026-11-21

Read from the primary sources on 2026-11-21. The copies are pinned by commit in the vendored file.

**OKF 0.2** (GoogleCloudPlatform/knowledge-catalog, `okf/SPEC.md`, Apache-2.0):
- A bundle is a folder tree. Every `.md` is a concept except the reserved `index.md` and `log.md`.
- A concept's frontmatter must parse and have a non-empty `type` string. Consumers "MUST NOT reject" a file for unknown types or keys.
- `status` is `draft`, `stable` or `deprecated`.
- `verified` is a list of `{ by, at }`, and a bare mapping counts as a list of one.
- `stale_after` is an instant: the concept is stale when `now >= stale_after`. Every timestamp is ISO 8601 with an explicit offset.
- A bundle may declare `okf_version: "0.2"` in its root `index.md`. That is the only frontmatter an index may carry.

**Ossie 0.3.0.dev0** (apache/ossie, `core-spec/ossie-schema.json` at `1b1ebb6`, Apache-2.0, with a NOTICE):
- Each file is one model. `version` (const `0.3.0.dev0`), `name` and `datasets` are required.
- `custom_extensions` is now `nonportable_extensions`.
- A metric has no dimensions. A segment is a dataset field, grouped at query time.
- The spec names no file pattern. Its compliance fixtures use `*.ossie.yaml`.

## Global Constraints

- No new file format. A unit stays in its native format, and `ctxlock.yaml` holds what ctxlock adds (§4.1).
- **IDs:** `knowledge/<path>` and `metric/<path>`, where the path is the file's.
- **Precedence:** `ctxlock.yaml` wins over a file's own trust fields, and lint says when they disagree (§4.1, as for skills' `metadata`).
- Agents never load the new kinds in Claude Code or Codex. Prediction, budgets and `build` leave them out.
- **Vendored code:** Ossie's schema keeps its ASF header and source commit. Ossie's NOTICE lines go into a root `NOTICE`, which is published with `dist`.
- Paths are posix, and every comparison of folder paths goes through the real-path functions already in use.
- Never put text with backticks, `$` or backslashes in a shell string; edit with the Edit tool.

## Review Focus

1. **A docs folder with Hugo or Jekyll frontmatter, not declared and with no `okf_version`:** it stays plain files, not units, even when its frontmatter has `type:`. (Task 1)
2. **An Ossie file written for 0.2.0.dev0:** it gets one clear finding, "Ossie 0.3.0.dev0 is the version this checks; the file says 0.2.0.dev0", not a raw schema dump. (Task 2)
3. **`verified` as a bare mapping, `verified` as a list, and a timestamp without an offset:** the first two give the same date. The third is an L17 finding and fills nothing. (Task 3)
4. **A link from a concept to a page that is no unit, a URL, or `#anchor`:** it makes no edge and no finding. A link to `./nrr.md#segment` makes an edge to `nrr.md`. (Task 4)
5. **A synced concept edited by hand in the consumer:** L16 flags it, and sync refuses to write over it, as for a rule. (Task 5)

---

### Task 1: The two kinds, found

**Files:**
- Modify:
  - `src/model.ts`: `UnitKind` gains `'knowledge' | 'metric'`, and `family` gains `'okf' | 'ossie'`;
  - `src/units/discover.ts`;
  - `src/registry/registry.ts`;
  - `src/scan.ts`.
- Test: `tests/units/discover.test.ts`, `tests/registry/registry.test.ts`, `tests/scan.test.ts`.

**Interfaces:**
- Produces:
  - `discoverUnits(reader: RepoReader, extra?: { knowledge: string[]; metrics: string[] })`;
  - `Registry.knowledge: string[]` (folders) and `Registry.metrics: string[]` (files or folders), from top-level `knowledge:` and `metrics:` lists in `ctxlock.yaml`, each through `repoPath`, default `[]`;
  - a knowledge unit's `frontmatter` and `body` from `splitFrontmatter`. Its `name` is the frontmatter's `title` when that is a string, else the file name without `.md`;
  - a metric unit's `frontmatter: null`, `body: text`, and `name` from the model's `name` when it parses, else the file name.

Which files are units (D102), checked after the existing patterns so a rule inside a bundle stays a rule:
- **knowledge:** each `.md` other than `index.md` and `log.md` that is either:
  - under a folder in `registry.knowledge`;
  - under a folder whose own `index.md` has `okf_version` in its frontmatter;
  - recorded in `ctxlock.lock` with an ID starting `knowledge/`.
- **metric:** a file named `*.ossie.yaml`, `*.ossie.yml` or `*.ossie.json`, or one that is either:
  - in `registry.metrics`, or a `.yaml`, `.yml` or `.json` file under a folder listed there;
  - recorded in `ctxlock.lock` with an ID starting `metric/`.

`scanRepo` reads the registry and the lock first, and passes their paths to `discoverUnits`.

- [ ] **Step 1: Write the failing tests** in `tests/units/discover.test.ts`, under `describe('knowledge and metric units')`:
  - **`'a bundle declared by okf_version, or in ctxlock.yaml, makes each concept a knowledge unit, and index.md and log.md are not concepts'`:**
    - a tree with `kb/index.md` (`okf_version: "0.2"`), `kb/metrics/nrr.md` (`type: Metric`, `title: Net revenue retention`), `kb/log.md`, and `other/a.md` with `type: Reference`;
    - `extra` is `{ knowledge: ['other'], metrics: [] }`;
    - expect IDs `knowledge/kb/metrics/nrr.md` and `knowledge/other/a.md`, the first named `Net revenue retention`, and no unit for either `index.md` or `log.md`.
  - **`'a docs folder with type: in its frontmatter is not knowledge until declared'`** (Review Focus 1): `docs/guide.md` with `type: docs` and no `extra` makes no unit.
  - **`'an *.ossie.yaml file, or a file ctxlock.yaml lists, is a metric unit named by its model'`:**
    - `models/sales.ossie.yaml` with `name: sales_analytics`, and `semantic/x.yaml` with `extra.metrics: ['semantic']`;
    - expect `metric/models/sales.ossie.yaml` named `sales_analytics`, and `metric/semantic/x.yaml`.
  - **`'a rule inside a declared bundle stays a rule'`:** `.claude/rules/kb/x.md` under `extra.knowledge: ['.claude/rules']`.
  - **In `tests/registry/registry.test.ts`, `'knowledge and metrics are lists of paths'`:** `knowledge: [kb/]` reads as `['kb']`; `metrics: 3` is a `RegistryError` naming `metrics`.
  - **In `tests/scan.test.ts`, `'a unit the lock records as knowledge is knowledge, though nothing else declares it'`:** a lock entry with id `knowledge/org/nrr.md` makes `org/nrr.md` a knowledge unit.
- [ ] **Step 2:** `npx vitest run tests/units/discover.test.ts tests/registry/registry.test.ts tests/scan.test.ts`. Expected: FAIL, with no such kind and no such registry key.
- [ ] **Step 3: Implement.**
  - **Bundle roots:** found once per scan from the listed `index.md` files whose frontmatter has `okf_version`.
  - **Model names:** read with `yaml`'s `parse(text, { schema: 'core' })`, or `JSON.parse` for `.json`. A file that does not parse is still a unit, named by its file; Task 2 reports it.
  - **TypeScript:** where a switch or a record over `UnitKind` fails to compile, put the new kinds in the branch that leaves units no agent loads out.
- [ ] **Step 4:** the same command, then `npx tsc --noEmit -p .` and `npx vitest run`. Expected: PASS, with no other test changed.
- [ ] **Step 5:** commit `feat: knowledge (OKF) and metric (Ossie) units`, mutation-check, push.

### Task 2: `L17-format`, each unit checked against its format

**Files:**
- Create:
  - `src/lint/rules/l17-format.ts`;
  - `src/units/ossie-schema.ts`, exporting `OSSIE_SCHEMA`: the schema JSON verbatim, under the ASF header, with the source URL and commit `1b1ebb620c6a47a85ae126ad21001b7013708ebf`;
  - `NOTICE`, holding ctxlock's own line plus Ossie's NOTICE text;
  - `tests/fixtures/ossie/`: Ossie's `spec.md` top-level example and `retail_model.ossie.yaml`, each with a comment naming its source and license.
- Modify:
  - `src/lint/run.ts`, to register the rule;
  - `src/lint/rules/l9-stale.ts`: a metric unit's text is YAML, so L9's path and script checks skip it, but its stale-after check still runs;
  - `package.json`: `ajv` under dependencies, and `NOTICE` in `files`.
- Test: `tests/lint/l17-format.test.ts`.

**Interfaces:**
- Produces rule `L17-format`, with one finding per problem, each with `unitId` and `path`:

| Unit | Problem | Severity |
|---|---|---|
| knowledge | no `type`, or one that is not a non-empty string | `must` |
| knowledge | `status` other than `draft`, `stable` or `deprecated` | `should` |
| knowledge | a `stale_after`, `generated.at` or `verified[].at` that is not ISO 8601 with an offset | `should` |
| metric | does not parse | `must` |
| metric | its `version` is not `0.3.0.dev0` | `must`, with the message in Review Focus 2, and no other finding for that file |
| metric | each schema error | `must`, as `<instancePath or (root)>: <ajv message>`, at most 5, then `and N more` |

  Frontmatter that does not parse stays `L0-frontmatter`. Discovery reports it as `must` for a knowledge unit, as it does for a skill.
- Ajv: `new Ajv2020({ allErrors: true, strict: false })` from `ajv/dist/2020.js`, compiled once per process.

- [ ] **Step 1: Write the failing tests:**
  - **`'the Ossie spec example and its retail model pass'`:** no L17 finding for either fixture.
  - **`'an Ossie file for 0.2.0.dev0 gets one finding that names both versions'`:** exactly one finding, with the message from Review Focus 2.
  - **`'schema errors are listed by where they are, five at most'`:** a model with seven datasets missing `source` gives five findings and an `and 2 more` finding. A model with `custom_extensions` names that key as `(root)`.
  - **`'a concept needs a type, a known status and timestamps with an offset'`:**
    - `type: ''` gives `must`;
    - `status: final` gives `should`;
    - `stale_after: 2026-12-31` gives `should`, naming `stale_after`;
    - the OKF spec's Appendix A example gives nothing.
  - **`'a metric unit is not read as Markdown by L9'`:** a model whose `description` has `` `src/missing.ts` `` gives no L9 finding.
- [ ] **Step 2:** `npx vitest run tests/lint/l17-format.test.ts`. Expected: FAIL, no rule.
- [ ] **Step 3: Implement.** `npm install ajv@8.20.0`, then the rule.
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: L17-format checks knowledge against OKF and metrics against Ossie's schema`, mutation-check, push.

### Task 3: Trust from OKF

**Files:**
- Create: `src/units/okf.ts`.
- Modify:
  - `src/scan.ts`;
  - `src/lint/rules/l17-format.ts`.
- Test: `tests/units/okf.test.ts`, `tests/scan.test.ts`, `tests/lint/l17-format.test.ts`.

**Interfaces:**
- Produces `okfTrust(frontmatter: Record<string, unknown> | null): { verifiedAt?: string; staleAfter?: string }`, as `YYYY-MM-DD` dates (D103):
  - **`verifiedAt`:** the UTC date of the latest `verified[].at`;
  - **`staleAfter`:** the UTC date of `stale_after` minus 1 ms. A concept stale from `2026-12-31T00:00:00Z` is then due by `2026-12-30`, which L9 flags from 2026-12-31, as OKF does. A `stale_after` later in a day is flagged from the next day;
  - a timestamp without an offset, or one that does not parse, gives nothing.
- `scanRepo` fills `registry.units[unit.path]` for each knowledge unit with `okfTrust` values only where `ctxlock.yaml` has no value. L9, `verify`'s `dueUnits` and `outcomes` then read them unchanged.
- `L17-format` adds `L17-trust-differs` (`should`) when both are set and differ: `ctxlock.yaml says stale-after 2027-01-31, the file's stale_after gives 2026-12-30; ctxlock.yaml wins`.

- [ ] **Step 1: Write the failing tests:**
  - **`'verified as a mapping or a list gives the latest date, and stale_after is due the day before its instant'`** (Review Focus 3):
    - `{ by: 'human:a', at: '2026-06-25T09:00:00Z' }` gives `2026-06-25`;
    - a list with that and `2026-07-01T23:30:00-02:00` gives `2026-07-02`;
    - `stale_after: '2026-12-31T00:00:00Z'` gives `2026-12-30`;
    - `'2026-12-31T12:00:00Z'` gives `2026-12-31`;
    - `'2026-12-31'` gives nothing.
  - **`'a concept past its stale_after is flagged by L9, and ctxlock.yaml wins when both are set'`:**
    - a scan on today `2026-12-31` gives `L9-stale` for the concept;
    - with `stale-after: 2027-01-31` in `ctxlock.yaml`, there is no L9 finding and there is one `L17-trust-differs`.
- [ ] **Step 2:** `npx vitest run tests/units/okf.test.ts tests/scan.test.ts tests/lint/l17-format.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: an OKF concept's verified and stale_after are its trust dates`, mutation-check, push.

### Task 4: Concept links are edges

**Files:**
- Create: `src/units/links.ts`.
- Modify: `src/graph/graph.ts`.
- Test: `tests/units/links.test.ts`, `tests/graph/graph.test.ts`.

**Interfaces:**
- Produces `linkedPaths(unit: Unit): string[]`: the repository paths the body's Markdown links point to, read from `markdown-it` link tokens. The links count only for knowledge units, since OKF makes them the concept's own record (D104).
  - Each link is resolved against the unit's folder, with its `#fragment` and `?query` dropped.
  - A link with a scheme, a bare `#anchor`, or a target outside the repository is left out.
- `buildGraph` adds an edge from a knowledge unit to each unit whose `path` or alias is a linked path, after the declared `depends-on`, with no duplicates. Links to no unit add nothing, and L15 stays about `ctxlock.yaml` alone.

- [ ] **Step 1: Write the failing tests:**
  - **`'a concept links to units by relative path, fragment dropped; URLs and anchors are not links to units'`** (Review Focus 4): the body `[a](../m/nrr.ossie.yaml) [b](./seg.md#x) [c](https://x.y/a.md) [d](#top) [e](../../../out.md)` in `kb/c/x.md` gives `['kb/m/nrr.ossie.yaml', 'kb/c/seg.md']`.
  - **`'impact of a metric reaches the concepts that link to it'`:** `impactOf` for an edit to `kb/m/nrr.ossie.yaml` lists `knowledge/kb/c/x.md` as a dependent. `whoUses` on the metric names it.
- [ ] **Step 2:** `npx vitest run tests/units/links.test.ts tests/graph/graph.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: an OKF concept's links to other units are depends-on edges`, mutation-check, push.

### Task 5: Sync the two kinds

**Files:**
- Modify: `src/sync/sync.ts`.
- Test: `tests/sync/sync.test.ts`.

**Interfaces:**
- Consumes Task 1's lock-recorded kinds: a synced concept is knowledge in the consumer with nothing declared there.
- The kind check allows `knowledge` and `metric`. Both take the single-file path a rule takes. The refusal message becomes `only skills, rules, knowledge and metrics sync`.

- [ ] **Step 1: Write the failing tests:**
  - **`'a concept and a model sync as one file each, and scan in the consumer as their kinds'`:**
    - the upstream has `kb/index.md` with `okf_version`, `kb/nrr.md`, and `models/sales.ossie.yaml`, and the consumer names both;
    - after sync, the consumer's lock has `knowledge/kb/nrr.md` and `metric/models/sales.ossie.yaml`;
    - the consumer's scan finds both units by kind, though it has no `index.md`.
  - **`'a synced concept edited by hand is refused and flagged'`** (Review Focus 5): sync refuses with `edited since the last sync`, and lint gives `L16-lock`.
- [ ] **Step 2:** `npx vitest run tests/sync/sync.test.ts`. Expected: FAIL, `only skills and rules sync`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: knowledge and metric units sync like rules`, mutation-check, push.

### Task 6: Probes that check an answer

**Files:**
- Modify: `src/eval/probes.ts`: `Expectation` gains `{ answer: string }`. `src/report/diagnose.ts` reads the key generically and needs no change.
- Test: `tests/eval/probes.test.ts`, `tests/eval/eval.test.ts`.

**Interfaces:**
- **`answer`:** a JavaScript regular expression tested against `Transcript.text`, the final reply, case-insensitively (D105). An agent's wording of a fact varies in case, while a command's does not.
  - It is an `adherence` probe. The expectation error lists `command, edit, skill, answer`.
  - The reply is used for grading only. No report prints it, as before.

- [ ] **Step 1: Write the failing tests:**
  - **`'answer matches the final reply, ignoring case, and not inverts it'`:** a transcript whose `text` is `NRR by Segment: SMB 104%` passes `answer: 'by segment'` and fails `not: true`. An invalid regex is a `ProbeError`.
  - **`'eval runs an answer probe on a knowledge unit, base against head'`:**
    - the fake-claude scenario replies `segment` when the run's copy of `kb/nrr.md` contains `segment`, and `no breakdown` otherwise;
    - a head that adds the word gives `improved`.
- [ ] **Step 2:** `npx vitest run tests/eval/probes.test.ts tests/eval/eval.test.ts`. Expected: FAIL. If fake-claude cannot reply text by file content, extend `tests/helpers/fake-claude.mjs` in this step: a behaviour's `text` already exists, and `when.file`/`contains` already exists.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** commit `feat: probes can expect an answer`, mutation-check, push.

### Task 7: Docs, decisions and a live run

**Files:**
- Create:
  - `the-guide/business-context.md`;
  - `docs/dogfood/2026-11-21-business-units.md`;
  - `journey/18-business-units.md`.
- Modify:
  - `journey/decisions.md` (D100–D105);
  - `README.md`: a "today" item, and the roadmap;
  - `the-guide/commands.md` and `the-guide/evals.md` for `answer`;
  - `the-guide/rules.md` for L17.

- [ ] **Step 1: The live run**, each step's output recorded in the dogfood report:
  - `scan` and `lint` on Google's `okf/bundles/acme_retail`, and on Ossie's example models, cloned to `F:/ctxlock-live/business`;
  - then an NRR fixture there:
    - an org repository with an Ossie model `revenue.ossie.yaml`. Its NRR metric has a `customers` dataset with no `segment` field;
    - an OKF concept `kb/nrr.md` linking to it;
    - an `answer` probe, "What is NRR by customer segment, from the model in this repository?", expecting `segment`;
  - then add the `segment` field and a sentence to the concept, and run `impact` and `eval --base` with real Claude Code on sonnet;
  - then `sync` into a consumer repository, and `lint` there.
- [ ] **Step 2: Write the docs** from what the run showed. The guide says what a unit of each kind is, how to declare a bundle, the precedence rule, how OKF dates map (with the day-before rule), and what L17 checks.
- [ ] **Step 3:** `npm run ci`. Expected: exit 0.
- [ ] **Step 4:** commit `docs: knowledge and metric units, D100-D105, and the live run`, push, watch CI.
