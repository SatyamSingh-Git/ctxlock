# The Context Conference keynote and the enterprise context-layer landscape

*Researched 2026-11-05. The search budget ran out partway through, so these are unverified:*
- *Collibra's 2026 product announcements beyond its MCP repo;*
- *Salesforce's hosted MCP;*
- *a Looker-specific semantic-layer MCP server;*
- *whether Databricks Genie Ontology went GA in early November 2026.*

## 1. Context Conference (Atlan, 2026-10-28)

**Event facts**
- Virtual, 8 sessions, about 3 hours. A full transcript is at <https://atlan.com/context-conference/transcript.md>. The event page is <https://atlan.com/context-conference/>.
- Atlan claimed about 1,500 live attendees. The conference is separate from Atlan Activate, which is the product conference.
- Sankar's keynote is titled **"Enterprise AI is missing a context layer"** (21 min). "Rent the intelligence but own the context" is her closing line.

**Sessions**
1. Keynote (Sankar).
2. "Why invest in context?" (AstraZeneca, BNY, UKG).
3. "Inside Verizon's context architecture".
4. "The company brain for shared skills and ontologies" (Atlan).
5. "The Post-AI Data Stack" (Workday, DocuSign, Upwork).
6. "Open sourcing a spec for AI registries" (Ben Hudson).
7. Debate, "Will open context interchange ever be real?": Bob Muglia, Josh Klahr (Snowflake), Prajakta Damle (Google), Dipti Borkar (Microsoft), Amandeep Khurana (Anthropic).
8. Recap.

**What the keynote cited beyond the summary:**
- MIT's "95% of genAI pilots fail";
- BCG's "5% future-built" companies with 3.6x shareholder returns;
- Gartner's "up to 80% higher agentic accuracy / 60% lower cost";
- an Atlan-commissioned MIT Tech Review study: 68% of organizations name governance or trust as the top AI barrier.

The transcript's "Apache ORC" is a mis-transcription of **Apache Ossie**.

### Announcements
| Name | What it is | Open? |
|---|---|---|
| **Atlan Trident** | A "shared context workspace for humans and agents": an AI registry for skills and agents. <ul><li>Skills arrive via Trident Desktop (imports from Claude Code and ChatGPT), GitHub SkillSync, the `aireg` CLI, or an API.</li><li>Versions and releases; an AI Gateway that routes model calls, MCP, metrics and ontology using the caller's permissions.</li><li>Traces tied back to agents, sessions and skills; evals.</li><li>Targets Claude Code, Codex and Cursor.</li><li>The demo showed dependency tracking, duplicate detection and merging, auto-versioning with pinning, and security scanning.</li><li>Atlan's own internal usage: about 1,100 skills (about 300 used in 30 days) and about 130 agents (53 active).</li></ul> | **Proprietary, private preview** |
| **AI Registry spec**, <https://github.com/atlanai/ai-registry> | "A registry is just files on storage": a Git repo or bucket plus metadata (versions, digests, status, ownership), synced into harnesses. <ul><li>Borrows npm's model for distribution and Iceberg's for interoperability.</li><li>Covers skills and agents now; MCP servers and metrics (via Ossie) are planned.</li><li>Draft v0.1, with the `aireg` CLI syncing to Claude Code, Codex and Cursor.</li><li>About 167 stars.</li></ul> | **Apache-2.0** |
| **FDE Playbook for Analytics Agents**, <https://github.com/atlanai/analytics-playbook> | <ul><li>Method: seal a golden question set *first*; mine metrics from past SQL and BI; run a governed lane ("no metric, no answer") and an exploratory lane; retrieve context per question via MCP.</li><li>Benchmark (107 questions, one warehouse): bare schema 31.8%; + docs 39.3%; + usage 43.9%; + AI-generated metrics and queries **83.2%**.</li><li>Loading the *whole* metrics layer into every prompt scored **52.3%** at more than 2x cost per correct answer.</li></ul> | CC BY 4.0 / MIT code |

### Other session facts
- **Verizon** plans an Enterprise Context Platform: a context object store plus an RDF knowledge graph with pub/sub, serving several third-party agent studios.
  - Initial scope: 16k documents and 23k knowledge articles.
  - It adopted Google's **OKF** for delivering context.
  - On lock-in: "If we decide to move away from any one of these tools, we will lose lots of context objects."
  - On authoring standards: "we don't have a standard yet" for agent operating procedures and playbooks.
  - The feedback loop is future work.
- **Post-AI Data Stack:**
  - Context mined from query history and BI with no human help reached 83%.
  - One customer needed at least 98% but got 89%.
  - **DDL-style table descriptions beat natural-language descriptions by about 20 points.**
  - An open-weight model with mined context matched frontier models.
- **Debate:**
  - Klahr (Snowflake): flagged OSI's weak expression language.
  - Damle (Google): structured context goes in OSI, unstructured in OKF; Google plans to join Ossie.
  - Borkar (Microsoft): interop is about 20% done.
  - Khurana (Anthropic): one base standard plus dialects, as with SQL; memory and feedback loops are undefined.

### Atlan Activate 2026 (2026-04-29)
- **Products:**
  - Context Agents (nine of them).
  - Context Engineering Studio: build, test, review, approve, deploy, learn.
  - Context Repos.
  - Context Lakehouse ("Iceberg-native"; MCP, API or SQL; 8B reads in 90 days).
- **Claims without published methods:** 40x output; "89% of AI-generated context rated ≥ human"; 58x growth in MCP calls.
- **Open source:** none of this was open-sourced. The local open-source MCP server is deprecated in favour of the hosted mcp.atlan.com. The **AI Registry is the only open spec.**

## 2. Where each keynote statistic actually comes from
| Keynote claim | Source | What was measured |
|---|---|---|
| Agents open a given skill: 46% (low end) | **SkillsBench**, arXiv [2602.12670](https://arxiv.org/abs/2602.12670) (v4 2026-06-14) | <ul><li>Skill Invocation Rate ranges from 46.4% (OpenHands + Gemini 3.1 Flash Lite) to 99.2% (Codex + GPT-5.5), across 87 tasks and 18 configurations.</li><li>**The paper's Finding 4: "Skill discovery is usually not the bottleneck."**</li><li>Curated skills raise the pass rate from 33.9% to 50.5%.</li><li>**Self-generated skills land 8–11.5 pp *below* the no-skill baseline.**</li></ul> |
| 49% load all needed skills; 31% with distractors; 51% → 44% | Liu, Ji, An, Jaakkola, Zhang, Chang, "How Well Do Agentic Skills Work in the Wild", arXiv [2604.04323](https://arxiv.org/abs/2604.04323) (2026-04-06) | <ul><li>**Claude Opus 4.6 only.**</li><li>Pass rates: forced loading 55.4%; agent picks from curated 51.2%; + distractors 43.5%; searching 34,198 real skills 40.1%; no skills 35.4%.</li><li>Counter-evidence: "Demystifying Agent Skills" ([2608.14036](https://arxiv.org/abs/2608.14036)) finds downstream success "stays stable", but precision of the skills actually used drops from 29.6% to 3.3% as the pool grows from 5 to 100.</li></ul> |
| Vercel: 53% as a skill vs 100% as an index | [Vercel blog, 2026-01-27](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | <ul><li>53% is the *pass rate*, identical to the no-docs baseline: the skill was never invoked in 56% of cases.</li><li>Skill plus an explicit instruction scored 79%. An 8KB compressed index in AGENTS.md scored 100%.</li><li>Vendor eval; model and task count not stated.</li></ul> |
| Fortune 100 bank: 90% of agents abandoned | **No public source** | Treat as an anecdote |
| Marketing changed positioning; the sales agent kept pitching the old version | Sankar, ["The GitHub for Context Doesn't Exist Yet"](https://contextandchaos.substack.com/p/the-github-for-context-doesnt-exist), 2026-07-16 | It was **Atlan's own** website agent. "Nothing declared the dependency." |
| Sweden +29% | MASAI RCT, Lancet Digital Health, Feb 2025 | <ul><li>Detection 6.4 vs 5.0 per 1,000, with 44% less reading workload.</li><li>The 2026 primary endpoint: 12% fewer interval cancers.</li></ul> |
| Nigeria: 2 years in 6 weeks | World Bank PRWP 11125, 2025-05-19 | 0.31 SD effect, equivalent to 1.5–2 years of schooling |
| Airline chatbot | Moffatt v. Air Canada, 2024 BCCRT 149 | The correct policy was on the same site, so this was a **conflict or grounding** failure, not only missing context |

**Related evidence the keynote didn't use:**
- ETH Zurich, "Evaluating AGENTS.md" ([2602.11988](https://arxiv.org/abs/2602.11988)): context files "do not generally improve task success" and raise cost by more than 20%.
- "Agent Skills Can Be Harmful" ([2608.11888](https://arxiv.org/abs/2608.11888)): 307 skill-induced failures. The biggest cause is "excessive procedure", and failures mostly come from *seemingly relevant* skills.

## 3. Landscape (late 2026)
| Vendor | Context artifacts | How agents consume them | Open? | Published accuracy |
|---|---|---|---|---|
| **Atlan** | Descriptions, metrics, ontologies, skills, agents, Context Repos, Trident | Hosted MCP; API/SQL on the lakehouse; `aireg` sync | AI Registry spec and playbook are open; the platform is closed | Playbook 31.8% → 83.2% |
| **Databricks** | UC Metrics (metric views), Semantics, Glossary (coming), **Genie Ontology** (learned snippets with an **OntoRank** authority score), Unity Gateway (models, agents, MCP, skills, tracing) | SQL, APIs, MCP | Metrics are open source in Spark/UC OSS; Genie Ontology is closed | None |
| **Snowflake** | Semantic views; **Cortex Sense** (mines query history, dbt, BI) | SQL, Cortex Analyst, Cortex Agents, managed MCP (`CREATE MCP SERVER`) | Proprietary; founded OSI | Cortex Analyst "90%+" vs GPT-4o 51% (internal); Cortex Sense 24.1% → 86.3% (question set unpublished) |
| **Microsoft** | Fabric IQ ontology (preview): entities, relationships, metrics from DAX, NL rules; manual versions; RDF/OWL import/export. Purview Unified Catalog. | MCP per item; Foundry tool | Closed, but **RDF export** is the best exit route | None |
| **Palantir** | Ontology objects, links, actions, functions | Ontology MCP (GA June 2026) | Closed | None |
| **Google** | Knowledge Catalog: `lookupContext` bundles, Knowledge Studio "context sets" (preview 2026-11-02), dbt MetricFlow import. **OKF**: Markdown + YAML frontmatter, v0.2 adds `sources`, `verified`, `stale_after` ([repo](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)). | MCP, APIs | OKF is open; the catalog is closed | None |
| **dbt Labs** | Semantic Layer / MetricFlow | dbt MCP ([repo](https://github.com/dbt-labs/dbt-mcp), Apache-2.0) | MetricFlow Apache-2.0 from v0.209 | None |
| **Apache Ossie** (formerly OSI) | Semantic model, datasets, fields, relationships, metrics, `ai_context`, `custom_extensions`, ontology folder. Spec 0.2.0.dev0 draft ([repo](https://github.com/apache/ossie), about 2.6k stars). | 22 converter projects ([converters](https://github.com/apache/ossie-converters)) | Apache-2.0 | n/a |
| Collibra | Glossary, contracts, lineage | MCP "chip" ([repo](https://github.com/collibra/chip)) | MCP server Apache-2.0 | None |
| Alation | Catalog, data products | Remote MCP; write tools removed Jan 2026 | SDK Apache-2.0 | None |
| DataHub | Entities, lineage, queries, **documents** | Self-hosted MCP ([repo](https://github.com/acryldata/mcp-server-datahub)) | Apache-2.0 | None |
| OpenMetadata | Catalog, glossary, lineage | Built-in MCP | Open source | None |
| Glean | Permission-aware document index | Remote MCP, documented for many coding agents; **Copilot not listed** | Closed | None |
| Salesforce | Tableau Semantics in Data 360 | Agentforce | Closed; has an Ossie converter | None |

**Ossie details**
- Launched 2025-09-23 by Snowflake and partners. Entered the Apache Incubator 2026-07-10. Now 50+ organizations, including Databricks, Microsoft and NVIDIA.
- Working groups: Metric Language, Catalog, Ontology, FSI.
- Open PRs: #246 (join semantics) and #237 (compliance suite).
- **No trust, provenance or freshness fields** ("definitions travel; trust does not").
- dbt Core 1.12 parses only v0.1.x.

**Agent-side standards**
- The Linux Foundation's AAIF hosts **MCP, AGENTS.md, A2A, goose and agentgateway**. Platinum members: AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI.
- The Agent Skills spec requires only `name` and `description`; optional fields are `license`, `compatibility`, `metadata` and `allowed-tools`. **There is no version, owner, dependency or eval field.**

## 4. Gaps
1. **Portability currently means MCP *calls*, not portable *definitions*.**
   - Formats are split: SKILL.md for skills, Ossie for metrics (draft), OKF for knowledge (v0.2), RDF for ontology (Fabric only).
   - Nothing bundles them into one versioned package with a lockfile.
   - The AI Registry is v0.1, covers skills and agents only, and doesn't target Copilot.
2. **No open spec models dependencies between artifacts and agents.**
   - Catalogs track *data* lineage, not "skill X uses metric Y, which feeds agents A, B and C".
   - Databricks Unity Gateway and Atlan Trident come closest. Both are closed.
3. **Feedback routing.**
   - Several products capture corrections: Cortex Sense, Genie snippets, Fabric agent proposals, Trident suggestions.
   - **Nobody publishes closed-loop numbers:** time to fix, regression rate, or how often a correction reaches the owner.
   - Verizon calls it future work. Anthropic's Khurana calls it undefined.
4. **Evals of context.**
   - Vendor numbers can't be reproduced. Atlan's playbook is the only described method. Ossie's compliance suite is unmerged.
   - Academic work shows context can *hurt*.
   - Nobody ships paired, versioned A/B evals per artifact.
5. **Retrieval shape.**
   - Vercel: an always-loaded small index wins.
   - Atlan: loading the full layer always (52.3%) loses to per-question retrieval (83.2%).
   - Together: a **small passive index plus on-demand details**. No standard defines that index.

## Top 10 insights
1. Re-source the keynote's numbers before reusing them: 49/31 and 51→44 are Opus 4.6 only; Vercel's 53% is a pass rate; the bank's 90% has no source.
2. **A passive index plus targeted retrieval.** Keep the active skill set small.
3. Opening a skill is not the main failure; relevant-looking skills cause harm. **Score task outcome and cost**, not whether the skill triggered.
4. **Define a manifest/lockfile layer above existing formats** (SKILL.md, AGENTS.md, Ossie, OKF, RDF) instead of new formats.
   - Missing fields: owner, version, digest, depends_on, consumers, eval_suite, status.
   - Align with or fork the AI Registry.
5. **Dependency tracking is the most open opening.** Build it from harness traces plus declared dependencies, and show the blast radius on PRs.
6. Use Ossie for metrics, but add trust metadata in an extension, borrowing OKF's `verified` and `stale_after`.
7. **Harness coverage is a differentiator.** Copilot and enterprise studios are poorly covered.
8. **Give feedback routing a measurable SLA.** Each correction becomes a PR with a regression test. Report time-to-fix and the regression rate.
9. **Paired, versioned evals per artifact.** Seal golden sets first. Track cost per correct answer.
10. **Neutrality is the wedge.** Platforms auto-learn context inside their own walls; be the portable, git-native system of record across all of them.
