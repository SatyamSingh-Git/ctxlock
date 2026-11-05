# Context-as-code: what exists and what's missing

*Researched 2026-11-05. The search budget ran out partway through, so data-catalog certification details are unverified. Repo stats come from the GitHub API on 2026-11-05.*

## 0. Bottom line
- **Single prompts are a solved problem.** Versioning, labels and rollback are commodity features in LangSmith, Langfuse, PromptLayer, Braintrust, Agenta, Portkey and Vellum. They all work the same way: an immutable version plus a movable label.
- **One artifact tested on its own is well served.**
  - General eval runners: promptfoo, DeepEval, Inspect.
  - With-skill vs without-skill comparisons: `claude plugin eval`, skill-creator, Tessl.
- **No tool evaluates a context change against the agents that depend on it.**
  - No product keeps a reverse-dependency graph from context artifacts (skills, metrics, docs) to the agents that consume them.
  - The closest prior art is from data engineering: dbt `exposures`, `state:modified+` slim CI, and OpenLineage. Nobody has applied it to agent context.
- **Some products propagate changes silently, by design.** In Langfuse (label-resolved references) and Portkey (partials), a new version auto-updates everything that uses it. That is the keynote's "collaboration wall" shipped as a feature.
- **License alert:** lakeFS moved from Apache-2.0 to BSL 1.1 on 2026-09-22.

## 1. Prompt and context management
| Tool | Versioning | Deploy / rollback | Trace link | Notes |
|---|---|---|---|---|
| **Langfuse** | Immutable numbered versions; `production` and `latest` labels; protected labels | Roll back by moving the label. The SDK caches, so traces just after an update may still use the old version. | Pass the prompt object into the generation; metrics per version | Acquired by ClickHouse Jan 2026; says it stays MIT |
| **Langfuse Skills** (beta 2026-11-03) | Versions a whole SKILL.md folder. Editing any file creates a new version. The manifest stores a hash per file. | Labels. Moving a label doesn't change installed files until `langfuse skills update`. | **Usage tab lists the observations that used each skill** | First prompt platform to manage skills as artifacts ([changelog](https://langfuse.com/changelog/2026-11-03-skill-management)) |
| **LangSmith** | Commit hashes, movable tags, diff view | `staging`/`production` tags; **only owners can promote** | Not verified | The public Hub is unreviewed |
| **PromptLayer** | Registry with release labels | **Dynamic release labels** split traffic across versions by % or segment | Log the version actually served (the label maps to the base version) | SaaS |
| **Braintrust** | Environments; `prompts push/pull` syncs to local files for PR review | Per environment | Claimed | Vendor claims a GitHub Action that blocks merges on score drops |
| **Agenta** | Variants work like branches but **cannot be merged** | Three fixed environments | Yes | MIT core plus `ee/` |
| **Portkey** | Frozen versions; references like `id@staging` | Labels | Gateway logs | **Partials auto-update in every template that uses them** |
| **Vellum** | Three tag kinds: latest, floating, static | Release history | Yes | Workflow → prompt node **pinned by release tag** is an explicit dependency edge |
| **Humanloop** | n/a | n/a | n/a | **Dead.** The team joined Anthropic; the platform was sunset 2025-09-08. |
| **Pezzo** | n/a | n/a | n/a | Dormant since May 2024 |

**Prompts as files:**
- Prompty v2: `.prompty` markdown plus frontmatter, with conformance vectors across languages.
- POML: stale since Aug 2025.
- BAML: a DSL with tests.
- DSPy: prompts are compiled outputs of programs.
- Mirascope.

None of these has labels, a registry or consumer tracking.

**Composition today:**
- Langfuse prompt references pin a version or resolve a label at fetch time. The docs list "update dependent prompts automatically" as a benefit.
- Langfuse webhooks are HMAC-signed.
- The Langfuse → GitHub sync goes **one way only**.

## 2. Evals and testing of context
**General eval runners**
- **promptfoo** (MIT; OpenAI announced it was acquiring promptfoo on 2026-03-09 and said it stays open source): YAML suites. `promptfoo-action` runs a **before-and-after comparison of changed prompt files on a PR** and posts a comment ([docs](https://promptfoo.dev/docs/integrations/github-action)).
- **DeepEval**: pytest-style metric thresholds, run in CI.
- **Inspect AI** (UK AISI, MIT): a task is a dataset + solver + scorer; Docker sandboxes; ready-made suites in `inspect_evals`.
- **OpenAI Evals**: legacy.

**Context-specific eval loops**
- **`claude plugin eval`** (Claude Code v2.1.269+, [docs](https://code.claude.com/docs/en/plugin-evals))
  - Each case lives in `evals/<case>/` with `prompt.md` and `graders/*.md`.
  - Graders: regex, tool_used, tool_order, file_exists, llm (passes on 2 of 3 votes), baseline. **No custom-code graders.**
  - Each case runs 3x with and 3x without the plugin, reporting WITH, W/OUT and Δ. **Δ never affects the exit code.**
  - Runs are isolated, so **no `.claude/`, CLAUDE.md or `.mcp.json` loads**. It cannot test a CLAUDE.md or AGENTS.md change, and it tests one plugin, not its consumers.
- **skill-creator** (Apache-2.0)
  - Cases in `evals/evals.json`; outputs `grading.json` and `benchmark.json`.
  - **Blind A/B between two versions of a skill**: the only built-in old-versus-new comparison found.
  - Also tunes the description using should-trigger and should-not-trigger prompts.
  - Its case format is not interchangeable with plugin eval's.
- **Tessl** ([blog](https://tessl.io/blog/three-context-eval-methodologies))
  - Skill review: structural, like linting.
  - Task evals: `task.md` + `criteria.json`, baseline vs with the tile.
  - Repo evals (beta): replay real commits.
  - Usually one run per condition; no regression tracking across versions.
- **Promptless "Agent Instructions"**: mines traces for recurring failures and proposes versioned fixes to skills, subagents, hooks, AGENTS.md and MCP configs. Each fix has an eval gate and an owner, and can auto-merge after evals pass. **Closest to our feedback loop, but closed.**

**LLM-as-judge pitfalls**
- Judges show position, verbosity and self-preference bias.
- Use binary pass/fail with written critiques, and report TPR/TNR rather than raw agreement.
- Pin both the agent model and the judge model.
- Judge variance grows with text length.

**Does any tool evaluate a context change against the agents that depend on it? No.**
- Some test the changed artifact's own suite.
- Some compare with versus without the artifact, in isolation.
- None selects the eval suites of the agents that depend on it, because none of them knows who those agents are.

## 3. Linting and static analysis
- **agnix** ([repo](https://github.com/agent-sh/agnix), MIT/Apache-2.0, Rust)
  - 758 rules across CLAUDE.md, AGENTS.md, SKILL.md, hooks, `.mcp.json`, `.mdc`, Codex, Kiro, Copilot, Gemini and Cline.
  - LSP, autofix, GitHub Action, WASM build.
  - No token-budget rules.
- **`claude plugin validate`**: schema check.
- **`skills-ref validate`**: "demonstration purposes only".
- **MCP tool descriptions**:
  - 97% of 856 tools have description smells ([2602.14878](https://arxiv.org/abs/2602.14878)).
  - A study of 10,831 servers lists 18 smell categories that change tool selection ([2602.18914](https://arxiv.org/abs/2602.18914)).
- **Token budgets and staleness**:
  - agentlinter: no license.
  - asitis-agent-tools: MIT, 0 stars.
  - agents-md-lint: finds paths and commands a context file mentions that no longer exist.
- **Platform budgets**:
  - Claude Code's skill listing gets 1% of the context window. Each description plus `when_to_use` is capped at 1,536 chars. When the listing overflows, the least-used skills' descriptions are dropped first.
  - `/skill-doctor` reports context cost and invocations, but "records whether a skill ran, not whether running it helped".
  - Augment caps user guidelines at 24,576 chars and workspace guidelines plus rules at 49,512.

## 4. Dependency tracking and impact analysis
**Prior art to copy**
- **dbt slim CI**: `dbt build --select state:modified+ --defer --state <prod-manifest>` diffs against the production `manifest.json` and builds what changed plus everything downstream.
- **dbt `exposures` is the closest model for "an agent declares what it consumes".**
  - Each downstream consumer gets a YAML block: `type`, a required `owner`, `maturity`, and `depends_on` listing `ref()`/`source()`/`metric()`.
  - `dbt test -s +exposure:x` tests everything upstream of that consumer ([docs](https://docs.getdbt.com/docs/build/exposures)).
  - **Swap "dashboard" for "agent" and "model" for "skill or metric", and you have the missing primitive.**
- **OpenLineage** (Apache-2.0): Run, Job and Dataset entities plus custom facets with git-SHA-pinned `_schemaURL`s. An agent run maps to a Run/Job, and the context artifacts it read map to input Datasets with a "context version" facet. Marquez stores the events.
- **ODCS v3.2.0** (Bitol, Apache-2.0): fundamentals, schema, quality, SLA, roles, team, authoritative definitions, custom properties. A template for a **context contract**.
- **Semantic layer**:
  - MetricFlow metrics are YAML in git with an informal `meta.owner`; dbt has no certification workflow.
  - OSI now lives at **apache/ossie**.
- **Backstage**: `dependsOn`/`dependencyOf` relations, a required `owner`, and a `lifecycle` (experimental, production, deprecated).
- **Pinning and review**: CODEOWNERS, semver, npm lockfiles. Tessl's `tessl.json` records installed skills, but no lockfile or semver rules are documented.

**Agent ↔ context graphs: has anyone built one?**
- **AgentFlow** (arXiv 2607.01640, July 2026): an Agent Dependency Graph over 5,399 agent programs. It targets security and bills of materials, not change impact, and no code was found.
- A TDS blog prototype of a prompt dependency graph; a GitHub issue proposing "if I change skill X, what's affected?"
- Runtime-observed consumers only: Langfuse's skill Usage tab; Atlan lineage via MCP. Neither is a dependency graph.
- **Conclusion:** nothing stores **declared plus observed** edges from agents to skills, metrics and docs, or answers "who breaks if I change this?"

## 5. Spec-driven and docs-as-code
- **GitHub Spec Kit** (MIT, ~148k stars): constitution → spec → plan → tasks, with extensions, presets and governed catalogs.
- **Kiro specs**: `requirements.md`, `design.md` and `tasks.md`. Tasks run in dependency-ordered waves. Markdown Review allows comments on individual passages.
- **Tessl**: relaunched 2026-01-29 as a "package manager for agent skills" (`tessl i`, `tessl skill publish`, `tessl.json`, an evaluated registry).
- **Packmind** ("ContextOps"): capture → version → distribute → govern across about 8 agents. Drift detection is enterprise-only. Apache-2.0 core ([repo](https://github.com/PackmindHub/packmind)).
- **Cursor team rules**: admins can require a rule. Precedence is Team > Project > User.
- **Augment**: `.augment/rules` with Always, Manual and Auto modes, and reads nested AGENTS.md and CLAUDE.md.
- **Claude Code managed policy**:
  - `managed-settings.json` plus `managed-settings.d/*.json`, so several teams can each own a slice.
  - MDM re-checks every 30 minutes; server-managed settings poll hourly.
  - Enterprise skills directory, with precedence enterprise > personal > project.
  - No skill version field.
- **Mintlify** auto-generates `llms.txt`, `llms-full.txt`, `.md` page variants and an agent-skills index.
- **Promptless** turns PRs, Slack threads and tickets into documentation PRs.

## 6. Non-engineer authoring
- **What exists:**
  - Prompt UIs: LangSmith, Langfuse, PromptLayer, Vellum, Agenta.
  - Role gates: LangSmith owner-only promotion; Langfuse protected labels.
  - Passage comments: Kiro.
  - Evidence-backed suggestions: Promptless.
  - Skills authored in claude.ai sync down to Claude Code.
- **What's missing:** a review that shows the **business effect** of a change, not just a text diff. For example: "this positioning edit changes the sales agent's answers on 14 of 40 cases; here are 3 side-by-side examples." Also missing:
  - required approvers assigned by business domain;
  - certification states that block uncertified definitions from reaching agents.
- Data catalogs (Atlan, Collibra, Alation) certify **data assets, not agent context** (unverified detail).

## 7. Versioned storage substrates
| Substrate | Branch / merge | Granularity | Fit |
|---|---|---|---|
| **Git** | Full, 3-way text merge, PRs, CODEOWNERS | File / line | **Canonical store for prose artifacts** |
| **Dolt** (Apache-2.0) | Git semantics on SQL; cell-wise merge | Row / cell | **Structured context**: metric registry, edge table, eval results |
| **TerminusDB** (Apache-2.0) | Branch, merge, time travel on a document graph | Document / triple | Ontologies; small community |
| **Nessie** (Apache-2.0) | Multi-table Iceberg commits | Table | Overkill unless the context lives in a lakehouse |
| **Iceberg** | Per-table branches and tags; write-audit-publish | Snapshot | Large eval and trace datasets only |
| **lakeFS** | Git over object stores | Object | **BSL 1.1 now: avoid** |
| **OCI + ORAS** (Apache-2.0) | Immutable digests, tags, signing, referrers | Blob | **Best distribution and pinning layer.** The MCP registry already accepts `oci` packages; ModelPack and KitOps package AI artifacts as OCI. |
| **CRDTs** (Automerge, Yjs, Loro; MIT) | Automatic merge of concurrent edits | Character / JSON op | Live co-editing for non-engineers. Commit snapshots to git for review. They merge text, **not meaning**. |

**Recommended stack:** Git as the canonical store, Dolt for registries and the graph, OCI digests for distribution and lockfiles, and a CRDT editor that produces PR-style proposals.

## 8. Capability × tool (Y = yes, P = partial or vendor claim, N = no)
| Tool | Version | Labels | Trace link | Evals | Dep graph | Non-eng | Portable |
|---|---|---|---|---|---|---|---|
| LangSmith | Y | Y | P | Y | N | P | N |
| Langfuse | Y | Y | Y | Y | P | P | P |
| PromptLayer | Y | Y (A/B) | P | Y | N | P | N |
| Braintrust | Y | Y | P | Y | N | P | N |
| Agenta | Y | Y | Y | Y | N | P | P |
| Portkey | Y | Y | Y | P | P | P | N |
| Vellum | Y | Y | Y | Y | P | P | N |
| promptfoo | git | N | N | Y | N | N | Y |
| DeepEval / Inspect | git | N | N | Y | N | N | Y |
| plugin eval / skill-creator | git | N | N | Y | N | N | P |
| Tessl | Y | N | N | Y | P | N | P |
| Packmind | Y | N | N | N | N | P | Y |
| Promptless | Y | N | Y | P | N | Y | P |
| Spec Kit / Kiro | git | N | N | N | P | P | P |
| dbt (analogy) | git | P | N | Y | **Y** | N | Y |

## 9. Reusable building blocks
**License flags**
- **Blocks embedding:** lakeFS (BSL 1.1 since 2026-09-22).
- **No license (all rights reserved):** cclint, agentlinter, and the `anthropics/skills` repo root. Only folders with their own LICENSE, such as skill-creator, are reusable.
- **Avoid copying:** `ee/` directories in Langfuse and Agenta.

| Block | Repo | License | Reuse |
|---|---|---|---|
| Eval runner | [promptfoo](https://github.com/promptfoo/promptfoo) + [promptfoo-action](https://github.com/promptfoo/promptfoo-action) | MIT | YAML assertions, providers, PR before/after diff, red-team plugins |
| Eval runner | [inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | MIT | Task/solver/scorer, Docker sandboxes, log viewer |
| Eval runner | [deepeval](https://github.com/confident-ai/deepeval) | Apache-2.0 | pytest integration, metrics |
| Judge scorers | [autoevals](https://github.com/braintrustdata/autoevals) | MIT | LLM-judge and heuristic scorers |
| Skill eval loop | [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) | Apache-2.0 (folder) | run_eval, aggregate_benchmark, improve_description, grader prompts, blind A/B |
| Registry | [langfuse](https://github.com/langfuse/langfuse) | MIT outside `ee/` | Version/label model, reference resolution, skill manifest hashes, webhooks, trace ↔ version link |
| Prompt management | [agenta](https://github.com/Agenta-AI/agenta) | MIT outside `ee/` | Variant/environment model |
| Formats | [prompty](https://github.com/microsoft/prompty), [baml](https://github.com/BoundaryML/baml), [dspy](https://github.com/stanfordnlp/dspy) | MIT / Apache-2.0 / MIT | Conformance vectors, test blocks, optimizers |
| Linter | [agnix](https://github.com/agent-sh/agnix) | MIT OR Apache-2.0 | 758-rule engine, LSP, autofix, Action, WASM |
| Skill spec | [agentskills](https://github.com/agentskills/agentskills) | Apache-2.0 | SKILL.md spec and parser |
| MCP | [inspector](https://github.com/modelcontextprotocol/inspector), [registry](https://github.com/modelcontextprotocol/registry) | Apache-2.0 | Test harness; `server.json` with OCI package type |
| Lineage | [OpenLineage](https://github.com/OpenLineage/OpenLineage), [Marquez](https://github.com/MarquezProject/marquez) | Apache-2.0 | Event model plus facets for context consumption |
| Catalog | [datahub](https://github.com/datahub-project/datahub), [backstage](https://github.com/backstage/backstage) | Apache-2.0 | Entity, ownership and lifecycle models |
| DAG / slim CI | [dbt](https://github.com/dbt-labs/dbt), [metricflow](https://github.com/dbt-labs/metricflow) | Apache-2.0 | ref/exposure model, state:modified+ selection, metric YAML |
| Contracts | [ODCS](https://github.com/bitol-io/open-data-contract-standard), [datacontract-cli](https://github.com/datacontract/datacontract-cli) | Apache-2.0 / MIT | Contract sections; breaking-change diff pattern |
| Semantics | [apache/ossie](https://github.com/apache/ossie) | Apache-2.0 | Metric format |
| Versioned SQL | [dolt](https://github.com/dolthub/dolt) | Apache-2.0 | Branch, merge, diff |
| OCI | [oras](https://github.com/oras-project/oras), [kitops](https://github.com/kitops-ml/kitops), [model-spec](https://github.com/modelpack/model-spec) | Apache-2.0 | Push/pull, referrers, media types |
| CRDT | [automerge](https://github.com/automerge/automerge), [yjs](https://github.com/yjs/yjs), [loro](https://github.com/loro-dev/loro) | MIT | Co-editing |
| Distribution | [packmind](https://github.com/PackmindHub/packmind), [spec-kit](https://github.com/github/spec-kit) | Apache-2.0 / MIT | Multi-agent renderers; preset catalog model |

## 10. Top 10 unsolved problems in context-as-code
1. **No consumer manifest for agents.** There is no dbt-`exposure` equivalent such as "agent X depends_on skill@^2, metric:arr, doc:positioning".
2. **Dynamic, implicit edges.** Agents pull context at runtime, so real dependencies only show up in traces. That needs a merged declared-plus-observed graph.
3. **Impact-selected eval CI ("slim CI for context").** Run the eval suites of every affected downstream agent when an artifact changes.
4. **Semver for prose.** No way to decide when a positioning-doc or metric-definition change is breaking.
5. **Silent propagation versus pinning.** No lockfiles plus Dependabot-style upgrade PRs for context.
6. **Eval economics and noise.** Cases × 3 runs × 2 arms; judge variance; Δ not used as a gate.
7. **Format fragmentation.** Even Anthropic's two eval tools use different case formats. There's no OCI media type for context packages and no common eval-case format.
8. **Business-semantic review UX.** Behavioral previews, domain-based approvers, and certification states that gate consumption.
9. **End-to-end provenance.** One trace standard recording the exact version of every artifact in the context window.
10. **Semantic conflict and drift detection.** Contradictions across artifacts and stale references. There's no "type checker" for consistency across the context set.
