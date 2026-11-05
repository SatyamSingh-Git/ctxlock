# The state of AI context: research synthesis

*Compiled 2026-11-05 from eight research reports (01–08 in this folder), together about 400 primary sources. Each claim below links back to the report that holds the evidence and the URLs.*

## The short answer

The **file formats** for agent context are settled. AGENTS.md, Agent Skills (SKILL.md) and MCP are open and governed by the Linux Foundation's Agentic AI Foundation (AAIF), and about 80 agents read skills.

The **plumbing** that moves those files into each tool is mostly built, and it is open source:
- **rulesync** compiles one source to about 70 agents.
- **Microsoft APM** provides a manifest, a lockfile with content hashes, policy files, drift audit and an SBOM.
- **Vercel `skills`** installs skills into 79 agents.
- **Atlan's AI Registry spec** is v0.1.

What nobody has built in the open is the layer the keynote calls the "nervous system". It has four parts:
1. **A dependency graph.** Which agents depend on which context, at which version, both declared and observed.
2. **Behavioral CI.** When a piece of context changes, run the evals of every agent that depends on it, before and after the change.
3. **Usage telemetry joined back to sources.** What each agent actually loaded and used, mapped to the source file and version.
4. **A feedback loop.** An agent miss becomes an owned, tested fix that reaches every consumer.

Each piece exists in a closed product (Atlan Trident, Databricks Unity Gateway, Decagon Autopilot, Promptless, Tessl) or for one domain only (Copilot Memory, CodeRabbit learnings). None of them is open, works with any agent, or is git-native.

**That gap is the opportunity.** In one phrase: **dbt + Dependabot + Sentry, for agent context.**

## What the keynote got right, and what to correct before you quote it

| Claim | Verdict | Source |
|---|---|---|
| Formats exist but nothing makes them work together ("before Iceberg") | **Mostly right.** The file layer is now common. What's missing is the "table format" (manifest/lockfile), the catalog API, a conformance suite, and anything for evals or feedback. | 02 §4 |
| 46% of agents open a given skill | Real, but it is the **worst** configuration (Gemini Flash Lite + OpenHands). The range is 46–99%. SkillsBench itself says discovery is "usually not the bottleneck". | 01 §2, 03 §0 |
| 49% load all needed skills, 31% with distractors, success 51% → 44% | Real, but **Claude Opus 4.6 only**, with pools capped at 5 skills. Another paper finds success stable as pools grow. | 03 §1 |
| Vercel: 53% as a skill vs 100% as an index | **Mislabelled.** 53% is the *pass rate*, identical to having no docs at all, because the skill was never invoked in 56% of runs. The 100% came from an **8KB pipe-delimited index** in AGENTS.md that points at files on disk. | 03 §1 |
| Fortune 100 bank: 90% of agents abandoned | **No public source.** Treat it as an anecdote. | 01 §2 |
| Sales agent kept pitching the old positioning | Real. It was **Atlan's own** website agent: "nothing declared the dependency". | 01 §2 |
| Airline chatbot invented a policy | Real (Moffatt v. Air Canada). The correct policy *was on the same site*, so this was a **conflict/grounding** failure, not only missing context. | 01 §2, 07 §3 |

**What the keynote undersold: context often hurts.**
- LLM-written AGENTS.md files *lower* success by 0.5–2 points and raise cost by 20–23%. Human-written ones add about 2.4 points (ETH Zurich).
- Self-generated skills land 8–11.5 points *below* having no skills (SkillsBench).
- Injecting the target skill lowered pass rates and raised token cost by 72–394% (WebDev-Skills).
- Researchers have catalogued 307 failures caused by skills, mostly from *relevant-looking* skills that impose "excessive procedure".
- "Comprehensive" skills add +0.7 points; "standard-length" skills add +21.5.

So "manage context like code" has to include **measuring whether context helps, and deleting the context that doesn't.** Nobody's product says this today. (03 §1)

## The stack today

| Layer | State | Leaders | Our move |
|---|---|---|---|
| File formats (skills, instructions, tools) | **Settled** under AAIF | AGENTS.md, Agent Skills, MCP 2026-07-28, Agent Plugins 1.0 | Adopt as-is. Invent no format. |
| Business-context formats | Emerging | Apache Ossie (metrics, draft 0.2), Google OKF (knowledge Markdown with `verified`/`stale_after`), RDF (Fabric ontology) | Adopt in a later phase |
| Compile to each agent's native files | **Solved** | rulesync (MIT, about 70 targets, 1.14M npm/mo), ruler, Vercel skills, APM compile | Depend on rulesync |
| Package, lockfile, policy | Emerging | APM (MIT, lock + hashes + policy + SBOM), Claude plugin semver deps, `skills-lock.json`, Atlan AI Registry v0.1 | Interoperate; don't build a package manager |
| Security scanning and signing | Components exist | Cisco skill-scanner and mcp-scanner, OpenSSF model-signing, nono trust policy, OPA/Cedar | Integrate in proportion to risk |
| **Dependency graph (agent ↔ context)** | **Missing in the open** | Closed: Atlan Trident, Databricks Unity Gateway. Partial: Langfuse Skills Usage tab (2026-11-03) | **Build** |
| **Behavioral CI for context changes** | **Missing** | Only single-artifact with/without tests: claude plugin eval, skill-creator, Tessl, promptfoo | **Build** |
| **Load telemetry joined to sources** | **Missing** | The signals exist (Claude `InstructionsLoaded` hook, Codex `skill.injected`, Copilot `skill.invoked`); nobody joins them | **Build** |
| **Feedback → owner → fix loop** | **Missing in the open** | Closed or single-domain: Decagon Autopilot, Sierra Ghostwriter, Intercom Fin, Promptless, Copilot Memory, CodeRabbit | **Build** |
| Trust semantics ("what AI is allowed to believe") | Fragments | OKF `verified`/`stale_after`, OWASP Agentic Skills schema, Copilot 90-day memory TTL, catalog certification | **Build** a small trust layer |

## Principle 1 (build context for agents): the evidence turned into rules

The full list of 20 rules is in 03. The eight that shape the product most:

1. **Keep a compact index always loaded, and the content on demand.** Vercel's 8KB index scored 100%, against 53–79% for skills. Atlan found per-question retrieval at 83.2% beat loading the full metrics layer at 52.3%.
2. **Never make critical context depend on the model choosing to fetch it.** Load it passively, or route it with a hook (forced hooks raised activation from 50% to 100% in one small test).
3. **Measure discovery separately from success, per model and per harness.** The same model invoked skills 90.4% of the time in one harness and 54.0% in another.
4. **Curate; don't auto-generate.** The −8 to −11.5 point and −2 point results above. A full rewrite can collapse context (one went from 18,282 tokens to 122 and fell below baseline).
5. **Ship only what the agent cannot discover for itself:** conventions, required tools, constraints. Not repo overviews.
6. **Small pools, focused modules, budgets.** Use 1–3 skills of standard length. Keep always-on rules under about 150 for frontier models (IFScale). Assume an effective window of 2–16K for retrieval that needs inference (NoLiMa).
7. **Defer tool loading beyond about 10 tools or 10K tokens.** Tool search raised Opus 4 from 49% to 74%. Keep prefixes stable so the KV cache stays warm (Manus).
8. **Ship every artifact as a hypothesis with a paired eval.** Compare with and without it, include a length-matched control, and test per harness, because format effects swing results by 40–76 points and don't transfer between model families.

**Each harness truncates the same source differently.** Codex caps the AGENTS.md chain at 32 KiB in total. Claude truncates skill listings at 1,536 characters and caps the whole listing at 1% of the context window. Codex caps its skill catalog at 2% of the window or 8,000 characters. Devin cloud reads the first 16 KiB of each AGENTS.md. Codex has no glob-scoped rules at all. (08)

## Principle 2 (manage context like code): what exists and what's missing

**Solved:**
- Versioning single prompts with movable labels: Langfuse, LangSmith, PromptLayer and others.
- Format conversion: rulesync.
- Lockfiles: APM.
- Single-artifact with/without evals: plugin eval, skill-creator, Tessl.
- Linting: agnix (758 rules).

**Missing** (04 §10):
- **A consumer manifest.** There is no dbt `exposures` equivalent for agents, so "who depends on this?" can't be answered.
- **Declared plus observed edges.** Agents pull context at runtime, so the true dependencies only show up in traces.
- **Impact-selected eval CI** ("slim CI for context").
- **Semver for prose.** There is no way to tell whether a change to a positioning doc is breaking. We can answer this empirically: a change is breaking if the evals of the agents that depend on it regress.
- **Lockfiles plus Dependabot-style upgrade PRs.** Langfuse and Portkey propagate changes silently, which is the collaboration wall shipped as a feature.
- **Review that shows business effect:** "this edit changes the sales agent's answers on 14 of 40 cases", not just a text diff.
- **Semantic conflict detection** across artifacts.

**Prior art to copy:** dbt `exposures` and `state:modified+` slim CI; OpenLineage facets; ODCS contracts; Backstage ownership and lifecycle; CODEOWNERS.

## Principle 3 (context as a compounding asset): what exists and what's missing

**What works** (05):
- Learning in context is cheap, but only when outcomes are verified. Examples: ACE +10.6 points, GEPA beating RL with 35x fewer rollouts, Training-Free GRPO for $18.
- Store context as small addressable units with helpful/harmful counters, merge changes with deterministic code, and make the **smallest justified edit**.
- Natural-language feedback beats scalar scores.

**What's missing:**
- No product routes an end-user trace to the owner of the specific artifact responsible. Atlan routes edit requests to owners, but not from traces. Glean emails feedback to a company alias.
- Attributing a failure to its cause is weak: 14.2% accuracy at the step level on the Who&When benchmark. At artifact granularity there are only tens of candidates, so counterfactual replay (ablate one artifact, re-run) is affordable.

**The best published loop (vendor-reported):** Decagon's Autopilot mines 100% of conversations, simulates each fix against the conversation that surfaced it plus a golden set of hundreds of conversations, and requires human sign-off on a diff.
- A Fortune 50 customer's resolution rate went from 30% to 55%.
- More than 85% of fixes were still live after 30 days.

**Join keys already exist.** The OTel GenAI conventions (still "Development") define `gen_ai.skill.name`, `gen_ai.skill.source.uri`, `gen_ai.retrieval.documents[].id` and `gen_ai.evaluation.result`. They have no owner field and no user-feedback event; we would add those.

**Biggest risks:**
- Poisoning through the feedback channel: MINJA reaches 98.2% injection success using queries alone.
- Goodhart on thumbs ratings (the GPT-4o sycophancy incident).
- Context collapse.

The mitigations: gate every update on verification, keep provenance, set TTLs, and require owner approval.

## Security: the shared context layer is the attack surface

Details in 07.
- **Real attacks:**
  - 1,184 malicious skills on ClawHub (ClawHavoc).
  - The Rules File Backdoor: invisible Unicode in rules files.
  - A planted AGENTS.md that hijacked Codex in more than 90% of runs.
  - CVEs in Claude Code, Cursor and Copilot through hooks, base URLs and auto-approve settings.
  - MCP rug pulls (postmark-mcp).
- **Scanners miss most attacks.** Cisco's scanner caught 7.7% of malicious skills with rules and 33.7% with an LLM judge.
- **What holds up is architectural:**
  - content addressed by digest and pinned;
  - trust tiers;
  - least-privilege distribution;
  - never shipping execution-affecting config (hooks, base URLs, auto-approve, MCP registrations) through the context channel;
  - quarantining feedback-derived changes;
  - showing reviewers the exact bytes the model will read.

## What to reuse (top picks; all licenses checked)

| Need | Reuse | License |
|---|---|---|
| Source formats | AGENTS.md, Agent Skills spec, Agent Plugins 1.0 schemas, MCP 2026-07-28 + SEP-2640 (skills over MCP) | MIT / Apache-2.0 |
| Compile to about 70 agents | **rulesync** (ruler as fallback) | MIT |
| Agent path table, skill installs | vercel-labs/skills (`docs/agents.md`) | MIT |
| Manifest/lockfile design and policy | **microsoft/apm** (interoperate; borrow its lock design) | MIT |
| Registry shape | Atlan AI Registry spec v0.1; MCP Registry OpenAPI | Apache-2.0 |
| Syntax and schema lint | **agnix** (758 rules, LSP, autofix, Action) | MIT/Apache-2.0 |
| Eval harnesses and tasks | **SkillsBench**, eth-sri/agentbench, vercel next-evals-oss, UCSB Skill-Usage | Apache-2.0 / MIT |
| Eval runner and PR action | promptfoo + promptfoo-action; Inspect AI | MIT |
| Skill eval loop and description tuning | skill-creator folder only (anthropics/skills has no license at the repo root) | Apache-2.0 |
| Text optimisation of artifacts | GEPA `optimize_anything` | MIT |
| Curator design | ACE (bullet IDs + counters + deterministic merge); re-implement rather than depend | Apache-2.0 |
| Span schema | OTel GenAI semconv; OpenInference | Apache-2.0 |
| Trace backend (team tier) | Langfuse (core only; avoid `ee/`) | MIT |
| Session parsers | agentsview, ccusage, simonw/claude-code-transcripts | MIT / Apache-2.0 |
| Lineage model | OpenLineage; dbt exposures/state selection | Apache-2.0 |
| Virtual filesystem for non-coding agents | just-bash `IFileSystem` (the Mintlify ChromaFs pattern) | Apache-2.0 |
| MCP serving | MCP TypeScript SDK | MIT → Apache-2.0 |
| Security | Cisco skill-scanner and mcp-scanner, sigstore model-signing, OPA/Cedar, Presidio, Gitleaks | Apache-2.0 / MIT |

**Do not embed these** (interoperate across a boundary only):
- OpenViking and Basic Memory (AGPL)
- ByteRover and Phoenix (ELv2)
- lakeFS (BSL since 2026-09-22)
- FalkorDB (SSPL)
- TruffleHog (AGPL)
- NoLiMa (non-commercial license)
- Langfuse `ee/` directories
- Unlicensed repos: AttriBoT, AgenTracer, cclint, agentlinter
- The anthropics/skills repo root (only folders with their own license are reusable)

## Closest players and what each lacks

| Player | Has | Lacks |
|---|---|---|
| Atlan Trident (closed) + AI Registry spec (open v0.1) | Registry, sync to Claude Code, Codex and Cursor, dependency view, evals, gateway | Open graph, evals and loop; Copilot support; open spec covers skills and agents only |
| Packmind (Apache-2.0 core) | Multi-agent rendering, approval, adoption tracking | Evals, trace loop; governance is a paid tier |
| Tessl (closed) | Registry, with/without task evals | Openness, AGENTS.md coverage, feedback loop |
| APM (MIT) | Manifest, lock, policy, audit, SBOM, compile to 9 agents | Graph, behavioral evals, telemetry, loop |
| rulesync / ruler (MIT) | Compilation | Everything after compilation |
| Langfuse Skills (MIT core, beta) | Skill versions + Usage tab from traces | Agent-agnostic edges, impact CI, owner routing |
| Promptless (closed) | Trace → fix PR with an eval gate and an owner | Openness; graph |
| Decagon and Sierra (closed) | The best published feedback loops | Support and CX only; closed |

## Naming

"ContextFS" collides in the same category:
- **contextfs.ai** is a paid "universal AI memory layer" that also holds the GitHub org and the PyPI name.
- At least six other repos use the name.
- "FS" also undersells the product, since the value is the graph, CI and feedback loop rather than a filesystem.

Candidate names that were free on GitHub, npm and PyPI on 2026-11-05 (domains not confirmed): **Contextfile, ctxlock, ctxdeps, Canon, Keelfile, Primerfile.** (06 §3)
