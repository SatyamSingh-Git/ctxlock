# ctxlock: design and plan

*Written 2026-11-05. Status: draft for Satyam's approval.*
- *Open source (Apache-2.0).*
- *First user: developer teams running several coding agents.*
- *Name checked free on 2026-11-05: GitHub org, npm (`ctxlock` and `@ctxlock`), PyPI and crates.io; ctxlock.com/.dev/.io/.org unregistered per RDAP. Trademarks and .ai not checked.*

*Evidence lives in [research/](../../../research/), starting with [00-synthesis.md](../../../research/00-synthesis.md).*

## 1. Intent

**The problem.** Models are rented: everyone gets the same intelligence at the same price. What differs is **context**: the instructions, skills, definitions, procedures and knowledge that tell an agent how *this* team or company works. Today that context is handled carelessly:
- It is copied by hand into each tool's file format.
- Nobody knows which agents depend on which piece.
- Changes ship without anyone checking whether they help or hurt.
- When an agent gets something wrong, the lesson stays in one person's chat.

The research shows the problem is real *and* measurable. Context often makes agents worse:
- LLM-written AGENTS.md files: −2 points and +20% cost.
- Self-generated skills: −8 to −11 points.

Nothing in the open answers "who breaks if I change this?"

**What we're building:** the open "nervous system" for agent context. It does not invent a new format and it is not another memory database. It is the layer on top of the formats that already won (AGENTS.md, Agent Skills, MCP), and it links three things:
- **Actors:** the people who own context, and the agents that consume it.
- **Artifacts:** the context units, kept in their native open formats.
- **Activity:** what agents actually loaded, how they did, and what users corrected.

**In one line:** dbt + Dependabot + Sentry, for agent context.
- *dbt:* a dependency graph, tests and slim CI over plain files.
- *Dependabot:* changes reach every consumer as reviewed pull requests.
- *Sentry:* agent misses become owned, triaged issues.

**Day one (phase 1, coding agents).** A platform engineer edits the testing rule in AGENTS.md. The PR check reports three things:
- Codex now runs `uv run pytest` in 6 of 6 probe runs, up from 0 of 6. Claude Code is unchanged at 6 of 6.
- The AGENTS.md chain grew to 29.1 KiB, against Codex's 32 KiB limit.
- The new rule contains a hidden U+200B on line 14 (a MUST failure).

None of this needs eval tasks written by hand.

**The north star (phases 2–3): the keynote's collaboration wall, solved for engineering teams.** The platform team changes the shared `api-conventions` skill in the org context repo, replacing the deprecated HTTP client with the new one. Before merge, the pull request shows:

```
ctxlock · behavioral diff
Changed: skill/api-conventions (owner @platform)
Consumed by 14 repos: Claude Code in 9, Codex in 5, Copilot CLI in 3
Probes (base vs head, 3 runs each):
  payments-api   Codex still imports legacy-http in 3/3 runs ▸ why: repo rule/http overrides the skill
  web-gateway    Claude Code now uses new-http in 3/3 (was 0/3) · tokens +2%
Conflicts: rule/http in payments-api contradicts skill/api-conventions@head
Budget: OK · Lint: OK · Required approvals: @platform, @payments-team
On merge: opens update PRs in 14 consumer repos (compiled per agent, ctxlock.lock bumped, probe results attached)
```

The keynote's own example (marketing changes positioning, and the sales agent keeps pitching the old version) is the same mechanism applied to business context in phase 4.

## 2. The three principles, mapped to mechanisms

| Principle | What it means here | Mechanisms (each traceable to evidence in research/) |
|---|---|---|
| **1. Build context for agents, not humans** | The shape and placement of context decide whether it gets used | <ul><li>A compiler that emits a **compact always-on index plus content on demand** (Vercel pattern).</li><li>Budget-fitting to each harness's limits.</li><li>Critical context routed by hooks rather than left to the model.</li><li>An evidence-based linter.</li><li>Discovery measured separately from success, per harness.</li></ul> |
| **2. Manage context like code** | Context is a production dependency | <ul><li>Git-native units in open formats.</li><li>Owners (CODEOWNERS).</li><li>Consumer manifests (dbt-style "exposures" for agents).</li><li>A dependency graph of declared plus observed edges.</li><li>**Behavioral diff CI**: the paired evals of the affected consumers, run on every change.</li><li>Lockfiles, and propagation PRs.</li></ul> |
| **3. Context as a compounding asset** | Every miss should improve context for everyone | <ul><li>Load and outcome telemetry joined to unit versions.</li><li>Signals of misses.</li><li>Clustering.</li><li>Tiered attribution.</li><li>Routing to the owner.</li><li>The smallest fix, as a quarantined proposal with its source trace.</li><li>Validation by replay.</li><li>Durability tracking.</li><li>Compounding metrics.</li></ul> |

**How it answers the keynote's three walls:**
- **Accuracy:** measured behavioral evals instead of vibes, plus trust tiers.
- **Collaboration:** a dependency graph, owners and a behavioral diff.
- **Portability:** open formats in git, compiled to about 70 agents via rulesync, with no lock-in.

## 3. Goals, non-goals, anti-goals

**Goals**
1. Show on any pull request that touches context whether the change helps or hurts the agents that use it, with variance and cost reported.
2. Answer "who depends on this?" and "what did this agent actually load?" for every context unit.
3. Turn agent misses into owned, tested fixes that reach every consumer, and measure time-to-fix, regression rate and reach.
4. Work on existing repos without migration: read AGENTS.md, CLAUDE.md, skills and rules as they are.
5. Run local-first, with no server required until the team or org tier.

**Non-goals (for now)**
- Data-warehouse and catalog connectors (Snowflake, Databricks, Atlan).
- Real-time collaborative editing.
- A web IDE.
- Fine-tuning models.
- A hosted SaaS.

**Anti-goals: things that would make this a failure even if it works**
- **A new context file format**, competing with AGENTS.md, Skills or MCP.
- **Another memory API or vector DB.** The landscape is full of them, and they are personal and ungoverned.
- **Auto-generating context and shipping it.** The evidence says this hurts. Generation is allowed only as proposals that pass evals and get owner approval.
- **Auto-merging feedback-derived changes into reviewed tiers.** That is the poisoning vector.
- **Reporting eval numbers without variance or cost.**
- **Rebuilding what exists:** compilers, package managers, linters, scanners. Depend on them, wrap them, or contribute upstream.
- **Shipping execution-affecting config through the context channel** (hooks, base URLs, auto-approve, MCP registrations) by default.
- **Hidden telemetry.** Prompt or response content never leaves the machine unless the user opts in.

## 4. Core model

Three entities, matching the keynote's triangle, plus a graph that connects them.

### 4.1 Units (Artifacts)
A unit is one piece of context in its **native open format**.
- **ID:** `<kind>/<name>`.
- **Version:** a content digest, sha256 over normalized bytes, with per-file hashes for directory units. This is the same approach APM, SEP-2640 and Langfuse use.

| Kind (phase) | Native format | Examples |
|---|---|---|
| `instructions` (1) | AGENTS.md / CLAUDE.md, whole file or heading section | Root AGENTS.md, nested AGENTS.md |
| `rule` (1) | Markdown with scope and activation; compiled to `paths` / `applyTo` / `globs` / `fileMatch` / `trigger` | testing rules for `src/**/*.test.ts` |
| `skill` (1) | Agent Skills directory (SKILL.md + files) | `release-notes` |
| `mcp` (1, read-only) | MCP server reference (`server.json` / config entry) | GitHub MCP |
| `hook` (1, flagged only) | Harness hook config | **Execution-affecting**: never distributed by default |
| `knowledge` (4) | Google OKF Markdown (`type`, `sources`, `verified`, `stale_after`) | positioning, pricing policy |
| `metric` (4) | Apache Ossie semantic model YAML | `nrr` |
| `procedure` (4) | An Agent Skill (agent operating procedure) | refund handling |

**Trust metadata lives in one repo-level registry file, `ctxlock.yaml`.** Agents never read this file. It works the way dbt's `schema.yml` or CODEOWNERS do: a manifest for tools, not a new context format.
- Why not frontmatter: AGENTS.md and most rule files have none. Codex would inject YAML frontmatter as raw text that counts against its 32 KiB cap. HTML comments fail lint rule L1.
- Each entry maps a unit (a path, or a path plus a heading for AGENTS.md sections) to the fields below.
- Skills *may* also carry the same keys in the Agent Skills `metadata` map. When the two disagree, the registry wins, and `ctxlock lint` warns. *(My call; this resolves builder-check question 4.)*

The fields:

| Key | Meaning | Default |
|---|---|---|
| `ctxlock.owner` | Owning person or team | Falls back to CODEOWNERS |
| `ctxlock.tier` | `certified` / `reviewed` / `imported` / `proposal` | `reviewed` for files already in git; `imported` for third-party |
| `ctxlock.verified-at` | When it was last checked | — |
| `ctxlock.stale-after` | When it needs re-checking | — |
| `ctxlock.sources` | Where the content came from | — |
| `ctxlock.depends-on` | Units this one relies on | — |

These field names line up with OKF's `verified`/`stale_after`, the OWASP Agentic Skills schema, and the metadata fields in Atlan's AI Registry spec. In `ctxlock.yaml` the keys drop the `ctxlock.` prefix, and list fields are real YAML lists. The prefix and comma-separated form apply only when a skill mirrors the keys in its Agent Skills `metadata` map, which holds strings only.

### 4.2 Consumers (Actors)
A consumer is an agent configuration that uses units. It follows the dbt `exposures` pattern, in `agents/<name>.yaml`:

```yaml
name: payments-api
owner: "@payments-team"
harnesses: [claude-code, codex, copilot-cli]   # where it runs
models: [claude-opus-5-5, gpt-5.5]             # pinned for evals
repos: [acme/payments-api]                     # or "this repo"
depends_on:
  - skill/api-conventions@certified            # tier or digest range
  - rule/testing
evals: [evals/payments-api]                    # suites run when anything upstream changes
maturity: production                           # experimental | production | deprecated (Backstage-style)
```

For coding-agent teams, a consumer is usually **one repo × the harnesses its developers use**. A manifest is optional. Undeclared consumers are still found (see below).

Consumers that nobody declared are still discovered, from telemetry: any (repo, harness) pair that loaded units. They show in the graph as implicit consumers, with a prompt to declare them.

**People** are owners, taken from `ctxlock.owner` and CODEOWNERS. Required approvals on a pull request come from the owners of every changed unit, plus the owners of every consumer whose evals changed.

### 4.3 Events (Activity)
Events are append-only, local-first records. Each one carries IDs and digests, never content (unless the user opts in).

| Event | Fields |
|---|---|
| `context.load` | session, harness, model, consumer?, unit_id, unit_digest, load_reason (`session_start` / `nested` / `glob` / `skill_invoked` / `import` / `mcp_read`), trigger_file, ts |
| `context.outcome` | session, signal (`eval_pass` / `eval_fail` / `user_correction` / `abandoned` / `thumbs_up` / `thumbs_down` / `tool_empty_result`), detail_ref, ts |
| `context.feedback` | session, text_ref (redacted), units in context, scope guess (personal / team / org), ts |
| `eval.result` | suite, case, harness, model, arm (base / head / none), pass, tokens, cost, steps, units_loaded[] |

Field names map onto the OTel GenAI conventions (`gen_ai.skill.name`, `gen_ai.skill.source.uri`, `gen_ai.evaluation.result`), with a `context.artifact.{id,version,kind,owner}` extension so events can be exported to Langfuse or any OTLP backend.

### 4.4 The graph
**Nodes:** units, consumers, owners, repos, harness targets.

**Edges:**
- `depends_on` (declared, from unit to unit and from consumer to unit).
- `loaded` (observed, from consumer or session to unit@digest, with counts and last-seen).
- `owns`.
- `compiled_to` (from a unit to the file it became in each harness).

**Storage:**
- Phases 1–2: SQLite under `.ctxlock/` (gitignored), rebuilt from git plus events.
- Org tier: aggregate events in a shared store. The choice is deferred to phase 3.

## 5. Components and what each reuses

| Component | Job | Built on (reuse) | Our own code |
|---|---|---|---|
| **`ctxlock scan`**: inventory and effective-context resolver | Find every unit in a repo. Answer "what will harness H load from cwd X?" by applying each harness's discovery, precedence, budget and truncation rules (research 08). | rulesync importers; a port of the skills-ref parser (Apache-2.0); vercel-labs/skills agent path table (MIT) | The per-harness resolution rules as data; the unit model |
| **`ctxlock lint`** | Syntax/schema checks plus agent-native and security rules (below) | **agnix** (758 rules, run as a binary or WASM); hidden-Unicode logic adapted from LLM Guard (MIT, archived) | About 12 evidence-based rules (below) |
| **`ctxlock build`**: compiler | **Phase 1: report and fill gaps, never overwrite.**<ul><li>Shows the effective context per harness, the budgets, and drift (where hand-maintained files say different things).</li><li>`--fill-missing` generates only targets that are absent, e.g. `.claude/skills` from `.agents/skills`, or Cursor `.mdc` files from rules.</li><li>The Vercel-style index is offered as a suggested PR, never applied silently.</li><li>Generated files are committed, because cloud agents read the repo. They are listed in `.ctxlock/generated.json` with digests rather than marked in-file, and `ctxlock check` catches drift in CI.</li></ul>**Phase 2, opt-in:** a single-source mode, where the canonical source is declared in `ctxlock.yaml` (default AGENTS.md + `.agents/skills`) and the other targets are generated. *(My call; resolves builder-check question 3.)* | **rulesync** as the backend for format translation | Index generation (Vercel pattern); budget fitting and the report; hook-routed critical context; the `compiled_to` record |
| **`ctxlock eval`**: paired evals | Run tasks with base vs head context (plus an optional no-context arm) per harness and model, n repeats, in a sandbox; collect pass rate, cost, steps and units loaded | Runner chosen in Spike S1. Candidates: promptfoo (MIT), benchflow/SkillsBench (Apache-2.0), Inspect (MIT). Tasks borrowed from SkillsBench, eth-sri/agentbench and next-evals-oss. | Arm orchestration; caching base-arm results by (context digest, task, harness, model); variance reporting; joining in units-loaded |
| **Collectors** | Emit `context.load` and `context.outcome` from real sessions | Claude Code plugin hooks (`InstructionsLoaded`, `PostToolUse`(Skill), `SessionStart`); Codex OTel `skill.injected` + rollout JSONL; Copilot CLI OTel `skill.invoked` (carries the path); session parsers from agentsview and simonw/claude-code-transcripts | Mapping path + digest to unit ID; redaction; a local JSONL sink |
| **GitHub Action** | Post the behavioral diff on PRs and gate on MUST failures | promptfoo-action pattern; apm-action | PR comment renderer; check status |
| **`ctxlock graph` / `who-uses` / `impact`** (phase 2) | Dependency queries, blast radius, impact-selected evals | dbt `state:modified+` idea; OpenLineage event model | Graph build and queries |
| **`ctxlock sync`** (phase 2) | Org context repo → PRs into consumer repos, with lockfile and evals | rulesync compile; APM lock design (and reading APM and `skills-lock.json` locks when present) | Dependabot-style PR bot; `ctxlock.lock` |
| **Loop** (phase 3) | Signals → clusters → attribution → owner issue or PR → validate → durability tracking | Ada's gap taxonomy; ACE delta/counter design; GEPA `optimize_anything` for drafting text fixes; Langfuse as an optional team backend | Signal detectors, attribution tiers, proposal quarantine, metrics |
| **Serve** (phase 4) | Context for non-coding agents | MCP TS SDK (resources + SEP-2640 skills); just-bash `IFileSystem` with per-user tree pruning (the Mintlify ChromaFs pattern) | `search_context`, `get_unit`, `report_context_gap` tools |

### 5.1 Lint rules beyond agnix
Each rule cites its evidence, which is in research/03 unless marked.

| Rule | Severity | Check | Evidence |
|---|---|---|---|
| L1 | MUST | Hidden Unicode (category Cf, the Tags block, bidi controls, zero-width characters) and HTML/markdown comments in any unit | 07: Rules File Backdoor, CamoLeak. Claude strips HTML comments, other tools may not |
| L2 | MUST | Execution-affecting config inside distributed context (hooks, base URLs, `autoApprove`, MCP registrations, env vars) | 07: CVE-2025-59536, CVE-2026-21852, CVE-2025-53773 |
| L3 | SHOULD | Over budget for a harness: AGENTS.md chain > 32 KiB (Codex); a file > 16 KiB (Devin cloud); skill description > 1,000 chars or with its trigger words not front-loaded; catalog over Claude's 1% or Codex's 2%/8,000 chars | 08 |
| L4 | SHOULD | Discoverable content (repo overview, directory listings, copies of README) in always-on files | ETH: overviews didn't reduce steps and duplicated the repo |
| L5 | SHOULD | Too many always-on instructions (more than about 150) | IFScale |
| L6 | SHOULD | Skill longer than "standard" (more than 500 lines or about 5k tokens) | SkillsBench: comprehensive +0.7 vs standard +21.5 |
| L7 | SHOULD | Near-duplicate skill descriptions, which act as distractors | Liu et al. |
| L8 | SHOULD | "Excessive procedure": mandatory verification or checklist steps | Agent Skills Can Be Harmful |
| L9 | SHOULD | Stale: paths or commands that no longer exist; `ctxlock.stale-after` has passed | agents-md-lint; Copilot citation re-validation |
| L10 | SHOULD | Unit has no owner | Principle 2 |
| L11 | INFO | Codex can't express glob rules, so this rule compiles to a nested AGENTS.md or a skill | 08 |
| L12 | INFO | Possible contradiction between units (optional LLM check) | Breunig's "clash"; Claude "may pick one arbitrarily" |

### 5.2 Eval design rules
**A statistical-power reality check** *(my calls; resolve builder-check questions 1 and 2).*
- A per-PR suite of 40 cases × 3 runs can only detect pass-rate swings of about 10 points or more.
- The harms in the research are often 0.5–3 points. ETH needed about 440 instances across several models for p≈0.04.
- One study found contradictions had no detectable effect on following a trivial rule.

So the **PR check leads with signals that are large and cheap**:
1. **Context probes.**
   - *Adherence probes* for rules and instructions. Example: "add a dependency" should produce `pnpm add` when a rule says to use pnpm.
   - *Trigger probes* for skills, with should-trigger and should-not-trigger prompts, adapted from skill-creator.
   - Probes are graded deterministically from the transcript: commands run, tools called, files touched, and units loaded.
   - Instruction-following is strong. ETH found a mentioned tool used about 160x more often than an unmentioned one, so a probe shows a real change in 3–6 runs.
   - Probes are **drafted by an LLM from the units themselves**, reviewed once, and committed under `evals/probes/`. They are tests, not context, so the "don't auto-generate context" evidence does not apply.
2. **Units loaded per arm**: did the agent even see the change?
3. **Cost, steps and tokens per task.** The ETH +20% cost effect was significant, and cost is cheap to measure.
4. **Lint and budget results.**
5. **A small golden suite** if the repo has one. Advisory only.

**Full statistical evals** (golden plus replayed tasks, more repeats, confidence intervals) run **on a schedule or when a maintainer adds a label**, not on every PR.

**Isolation without Docker** *(my call, from Satyam's constraints on 2026-11-05)*:
- Every run happens in a throwaway copy of the repo at the arm's ref.
- Claude Code gets run-scoped hooks through `claude -p --settings <file>`, so nothing is written into the adopter's repo:
  - `InstructionsLoaded` and Skill-tool hooks record what loaded;
  - for probes, a `PreToolUse` hook **records the intended action and denies it** (observe-and-deny), so probes run no commands and touch no network.
- Golden tasks that must execute run with an allowlist of commands.
- In CI, the ephemeral GitHub-hosted runner is the sandbox.

**Defaults** (configurable):
- **Budget:** a per-PR budget counted in **runs and minutes** (default 24 runs and 20 minutes), not dollars, because runs may use a Claude subscription rather than API billing.
- **Auth:** an API key or a Claude subscription token. S1 verifies which subscription flow works headless in CI.
- **Forks:** PRs from forks get no secrets, so a maintainer must add a label to run them.
- Evals use the pinned models from consumer manifests. A cheaper smoke-test model is allowed only when it is clearly labelled.

**Task sources for phase 1:**
1. Probes, as above.
2. Hand-written golden tasks scaffolded by `ctxlock eval init`.
3. Replayed commits come in phase 2. They are the flakiest part of SWE-bench-style harnesses, because each repo needs its own environment build.

- **Arms.** Every case runs **base** (merge-base context) and **head** (PR context). An optional **none** arm measures whether the context helps at all, and an optional **length-matched control** separates length effects from content effects.
- **Repeats and reporting.** At least 3 runs per arm by default. Report the pass-rate delta with a confidence interval, cost and steps per task, and **units actually loaded per arm**. That last number measures discovery separately from success.
- **Graders.** Deterministic graders first: tests pass, file exists, exit code, regex. An LLM judge comes second, with the judge model **and** the agent model pinned. Judges give binary verdicts with critiques.
- **Gating.**
  - Gate only on deterministic regressions with a big enough sample, or on MUST lint failures.
  - Everything else is advisory.
  - Always show cost. Never gate on the delta from LLM-judged cases alone.
- **Cost control.**
  - Cache base-arm results keyed by (context digest, task, harness, model version).
  - Run only on PRs that change units.
  - Impact selection (phase 2).
  - A per-PR budget cap that degrades to lint plus budget checks when exceeded.
- **Task sources.**
  1. Hand-written golden tasks, **sealed before any context is tuned** (Atlan playbook).
  2. Replayed real commits (eth-sri/agentbench generator; Tessl's repo-evals idea).
  3. Phase 3: failing traces turned into regression cases.

## 6. Phased plan

Rough effort guesses for one builder working with AI; they are guesses, not commitments.

### Phase 0: Spikes (about 1–2 weeks). Throwaway; answers the risky questions.
- **S1. Eval runner.**
  - Run Claude Code headless (`claude -p` on a Claude subscription) on one public-repo task, with base vs head context.
  - Run it in a throwaway copy with run-scoped `--settings` hooks; no Docker.
  - Capture pass/fail, turns, duration, the usage the JSON output reports, and the units loaded.
  - Decide the runner substrate (promptfoo custom provider vs a thin own runner) and record usage per paired run.
  - **Must:** drive Claude Code headless, isolated per run, and capture its transcripts. More harnesses join once someone with access contributes them.
  - **Should:** be able to drive a custom agent later (an HTTP endpoint, or an agent that gets its context through MCP) for phase 4. This is a tie-breaker, not a requirement, because the first user is coding-agent teams. *(My call; resolves builder-check question 6.)*
- **S2. rulesync as backend.** Drive rulesync programmatically (library or CLI) from our unit model for Claude Code, Codex, Copilot and Cursor. Confirm what it emits and where we must add things (index, budgets).
- **S3. Reproduce a published effect** with Claude Code only and no Docker. Show that our harness reproduces the *direction* of two known results:
  - (a) ETH's adherence effect: a tool named in AGENTS.md gets used, and an unnamed one does not;
  - (b) Vercel's finding: a passive index beats an on-demand skill for facts the agent must look up.

  **This makes the tool credible.**
- **S4. Telemetry join.**
  - Confirm that Claude Code's `InstructionsLoaded` + skill events can be joined to unit IDs and digests.
  - Codex predictions are checked statically instead, by porting the cases in Codex's open-source loader tests (`codex-rs/core/src/agents_md_tests.rs`, Apache-2.0).

**Exit:** a short decision memo covering runner choice, integration mode, and usage per run (turns, minutes, and how much of the subscription's usage window a probe run takes).

### Phase 1: Context CI for one repo (MVP, about 4–6 weeks)
- **Commands.** `ctxlock scan`, `ctxlock lint`, `ctxlock build` (plus a budget report), `ctxlock eval --base <ref> --head <ref>`.
- **GitHub Action** posting the behavioral diff.
- **Collectors** for Claude Code, used inside each eval run.
- **Codex** gets static prediction, lint and budgets. Its runtime evals wait for a contributor with Codex access.
- **Exit criteria:**
  - Works on **3 public repos** that already have AGENTS.md or skills, with no migration.
  - **Catches planted edits in both directions** (mutation-check style), using edits whose effects are large enough to detect per PR:
    - (a) a rule that changes a required command, caught by adherence probes;
    - (b) a skill description edited so it no longer triggers, caught by trigger probes;
    - (c) an overview that bloats always-on context, caught by the cost/tokens delta and the budget check;
    - (d) a hidden-Unicode instruction, caught by lint.
    - Reverting each edit must clear its flag.
  - Small accuracy effects (about ±2 points) are explicitly **out of scope for PR checks**. They belong to the scheduled benchmark mode.
  - Reports the cost and run time of each PR check.
  - All MUST lint rules have tests in both directions.

### Phase 2: Graph and propagation (about 4–6 weeks)
- **Graph.** Consumer manifests; observed `loaded` edges from local collectors.
- **How edges travel with no server** *(my call; resolves builder-check question 5)*:
  - The blast radius comes from **declared** sources: consumer manifests, plus the `ctxlock.lock` that `ctxlock sync` writes in every consumer repo. Together they say which repos pin which unit digests.
  - **Observed** edges come from two places:
    - (a) CI eval runs, which give ground truth per harness on eval tasks;
    - (b) an **opt-in `ctxlock report`** that exports aggregated summaries (unit ID, digest, harness, counts; no prompts or content) to the org context repo or as a CI artifact.
  - A shared event store is still phase 3.
- **Queries.** `ctxlock who-uses <unit>`, `ctxlock impact <ref>` (blast radius), impact-selected evals.
- **Propagation.** An org context repo → `ctxlock sync` opens compiled PRs in consumer repos, with a `ctxlock.lock` and eval results attached ("Dependabot for context").
- **Collectors** for Copilot CLI and Cursor (best effort).
- **Exit criteria:**
  - A multi-repo demo where one upstream edit produces the correct blast radius.
  - Observed edges match `InstructionsLoaded` ground truth.

### Phase 3: The compounding loop (about 6–8 weeks)
- **Signals** from transcripts: user corrections ("I actually wanted…"), relevant skill not loaded, tool returned empty, abandoned session, thumbs.
- **Clustering**, with a threshold before routing: several distinct users or sessions, or a severity override.
- **Tiered attribution:**
  1. Exposure statistics per unit version.
  2. An LLM diagnosis using Ada's taxonomy: defect, gap, preference, or agent error.
  3. Counterfactual replay that ablates or edits the top candidate units.
- **Routing.**
  - A GitHub issue to the owner, or a draft PR with the **smallest fix**, carrying the source trace(s) as provenance.
  - Proposals live in the `proposal` tier and are never auto-merged.
  - Sessions that took in untrusted content are scored down.
- **Validation.** Replay the surfacing traces plus the consumer's golden set. The PR must improve the cluster with no regressions elsewhere.
- **Monitoring.** Durability at 7 and 30 days, helpful/harmful counters per unit, re-verification when `stale-after` passes.
- **Metrics:** time-to-fix, regression rate, fixes × consumers reached, units never loaded (candidates for deletion).
- **Exit:** an end-to-end demo from a real miss to a shipped fix in N consumers, with each step timed.

### Phase 4: Business context and non-coding agents
- **New unit kinds:** `knowledge` (OKF), `metric` (Ossie), `procedure` (AOP skills).
- **Serving.** An MCP server (resources + SEP-2640 skills + a `report_context_gap` tool) and a read-only virtual filesystem with per-principal pruning.
- **Exit:** the keynote's NRR-by-segment example, end to end. The metric owner gets the routed feedback, adds a dimension, evals pass, and every consumer updates.

### Phase 5: Open specs, earned by the reference implementation
- **Publish small specs** for what is missing:
  - the consumer manifest;
  - the context event schema (as an OTel GenAI extension);
  - a portable eval-case format;
  - the trust fields.
- **Propose them upstream:** agentskills #110 (dependencies), agentskills #255 (`.well-known` index), OTel GenAI, AAIF.
- **Follow Apache Ossie's pattern:** spec + SDK + compliance grader + converters.

## 7. Security and trust (in proportion to each phase)
| Phase | Controls |
|---|---|
| **1** | <ul><li>L1 and L2 lint as MUST rules.</li><li>Eval sandboxes have no network by default, beyond the model API.</li><li>Collectors store IDs and digests only, never content.</li><li>Nothing executes from units during scanning.</li></ul> |
| **2** | <ul><li>Digest pinning in `ctxlock.lock`, with any change requiring re-approval (anti rug-pull).</li><li>`imported` tier for third-party units, with Cisco skill-scanner results stored as attestations.</li><li>`ctxlock sync` never distributes hooks or MCP registrations unless explicitly allowed per consumer.</li></ul> |
| **3** | <ul><li>Proposal quarantine with trace provenance.</li><li>Rate limits per source.</li><li>PII and secret redaction (Presidio, Gitleaks) before any trace text is stored.</li><li>Agents can never set `ctxlock.tier` or write `certified` units.</li></ul> |
| **4+** | <ul><li>Signed bundles (OpenSSF model-signing over unit directories).</li><li>Policy-as-code (OPA or Cedar) for which agent may read which unit.</li><li>Revocation lists.</li></ul> |

The full checklist is in [research/07](../../../research/07-security-governance.md).

## 8. Success metrics
- **Phase 1 (adoption and credibility):**
  - The CI flags a real harmful context change on a public repo.
  - Cost per PR check stays at or below a stated budget.
  - At least one outside repo adopts the GitHub Action.
- **Phase 2:**
  - Blast radius is correct.
  - The share of consumers that are declared rather than implicit.
- **Phase 3, the compounding numbers nobody publishes today** (research 01 §4, 05 §8):
  - median time from first signal to shipped fix;
  - regression rate of shipped fixes;
  - durability at 30 days;
  - fixes × consumers reached;
  - context deleted, because units that never load or that hurt get removed.

## 9. Risks
| Risk | Mitigation |
|---|---|
| Platforms ship these features: Atlan Trident, Langfuse Skills, Tessl, Claude/Codex built-ins | <ul><li>Stay neutral across about 70 harnesses.</li><li>Stay open, local-first and git-native.</li><li>Integrate with them rather than compete: import from and export to Langfuse, APM and the AI Registry.</li></ul> |
| Eval cost and noise make the CI annoying | <ul><li>Cache the base arm.</li><li>Impact selection.</li><li>Deterministic graders.</li><li>Report variance.</li><li>Advisory by default.</li><li>Budget cap.</li></ul> |
| Harness churn (Gemini CLI → Antigravity, Roo end-of-life, Windsurf → Devin) | <ul><li>rulesync absorbs target churn.</li><li>Keep harness rules as data, not code.</li></ul> |
| Some harnesses expose no telemetry (Kiro, Cline) | Fall back to static resolution, labelled "predicted, not observed" |
| The tool itself becomes an attack vector | The phased controls in §7 |
| Name collision | **Resolved: renamed to ctxlock.** The only other uses are small Go mutex libraries, a different domain. Run a trademark search before any 1.0 announcement. |

## 10. Decisions
**Satyam's decisions (2026-11-05):**
- It is an **open-source project**.
- The **first user is developer teams running several coding agents**.
- The **name is ctxlock**:
  - npm package `ctxlock`, CLI `ctxlock`;
  - registry `ctxlock.yaml`, lockfile `ctxlock.lock`, local state `.ctxlock/`.
- **Build environment:**
  - Claude Code only, through the `claude` CLI on a Claude Max subscription. No API keys.
  - No OpenAI or Codex access.
  - No Docker.

**My calls (please check):**
1. **TypeScript** for the CLI, Action, collectors and MCP server. It matches rulesync, the MCP TS SDK, vercel skills, just-bash and promptfoo, and your other projects. The eval runner may shell out to Python harnesses if S1 picks one.
2. **Apache-2.0 license.** It includes a patent grant and is compatible with every reuse pick.
3. **Local-first.** No server until the phase-3 org tier.
4. **Native formats are the source of truth.** Phase 1 needs no migration.
5. **First harnesses:** Claude Code and Codex, which have the best telemetry and the most use. Then Copilot CLI and Cursor.
   - **Claude Code** is predicted, observed and evaluated.
   - **Codex** is predicted only. Its resolver is checked against cases ported from Codex's own Apache-2.0 loader tests. Runtime evals for Codex wait for a contributor with access.
6. **Build on others' work.** Depend on rulesync, agnix and an existing eval runner. Interoperate with APM, Atlan's AI Registry, Langfuse and Packmind rather than fork them.
7. **Wedge order:** behavioral CI first (provable value on day one), then the graph, then the loop.
8. **Settled after the builder check** (details inline, each marked "my call"):
   - Trust metadata lives in a `ctxlock.yaml` registry, not in frontmatter.
   - In phase 1, `ctxlock build` reports and fills missing targets, and never overwrites.
   - PR checks lead with probes, units loaded, and cost; full statistical evals run on a schedule or a label.
   - The default per-PR budget is counted in runs and minutes (24 runs, 20 minutes), using an API key or a Claude subscription token.
   - Evals are isolated without Docker: a throwaway copy per run, run-scoped `--settings` hooks, and observe-and-deny probes.
   - In phase 2, edges travel through lockfiles, CI runs, and an opt-in `ctxlock report`.
   - The eval runner must also be able to drive custom agents.

## 11. Left to the builder
- The eval runner substrate (S1).
- rulesync integration mode (S2).
- SQLite schema.
- Clustering algorithm (embeddings + HDBSCAN vs grouping with an LLM).
- PR comment layout.
- Default repeat counts.
- Exact budget numbers. Re-verify them against current docs when building, because harness limits change often.

## 12. Open questions
All answered (§10). Once this document is approved, the next step is a detailed implementation plan for phase 0 (spikes) and phase 1 (Context CI).
