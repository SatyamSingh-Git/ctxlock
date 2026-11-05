# Self-improving context, memory, trace infrastructure, and feedback routed to owners

*Researched 2026-11-05. Tags: [P] peer-reviewed, [A] arXiv preprint, [V] vendor-reported.*

## 0. Bottom line
- **Learning in context, rather than in the weights, works and is cheap. It holds only when the feedback signal is reliable.**
  - Results: ACE +10.6 on agent tasks; GEPA beats GRPO by about 6 points with up to 35x fewer rollouts; Training-Free GRPO +5.4 on AIME25 for about $18.
  - All of them degrade without labels or verifiers. ACE loses 3.4 points on FiNER without labels.
  - Weak curators cause two failures: "context collapse" (a rewrite wipes out most of the context) and stale contradictions left in place.
- **Most memory products are personal.** Glean says memory "doesn't create cross-company or cross-user learning". Claude Code's auto memory is machine-local.
- **Shared memory exists in two forms:**
  - scoping IDs: Mem0, Letta, Graphiti;
  - gated loops for one domain: Copilot repo facts, CodeRabbit learnings, Bugbot rules, Devin Knowledge, Zep Agent Skills, Decagon Autopilot.
- **No product found routes an end-user trace to the owner of the specific artifact responsible** (a metric, ontology term or document). Atlan routes edit requests to asset owners, but those requests are not triggered by traces.
- **Trace standards already carry the join keys.** OTel GenAI (all "Development") defines `gen_ai.prompt.name/version`, `gen_ai.skill.*`, `gen_ai.memory.record.id`, `gen_ai.retrieval.documents[].id`, `gen_ai.data_source.id` and `gen_ai.evaluation.result`.
- **Clustering failures is a commodity.** Attributing them to an artifact is not: products offer only exposure statistics, not causal blame.
- **Attribution research.** Passage-level methods work inside one context (ContextCite, AttriBoT, TracLLM). Attributing failures in agent runs is weak: on Who&When, step-level accuracy is **14.2%**.
- **Top risks:**
  - poisoning through the feedback channel (MINJA: 98.2% injection success using queries alone);
  - Goodhart on thumbs ratings (GPT-4o sycophancy);
  - context collapse.

## 1. Self-improving context: the research
| Method | Mechanism | Gains | Failure modes |
|---|---|---|---|
| Reflexion [P] | Verbal self-critique kept across retries | HumanEval 91 vs 80 | Needs an evaluator; works only within one task |
| ExpeL [P] | Insights from success/failure pairs via ADD/EDIT/UPVOTE/DOWNVOTE; deleted at count 0 | ALFWorld 59 vs 40 | Successful trajectories can still be suboptimal |
| Voyager [A] | Library of executable code skills plus self-verification | 3.3x more unique items | Needs a verifiable environment |
| AWM [A] | Reusable workflows induced from trajectories | WebArena +51.1% rel | Only as good as the success judge |
| SkillWeaver [A] | Propose → synthesize code skill → refine | WebArena +31.8% rel | Breaks when sites change |
| Dynamic Cheatsheet [P] | Self-curated memory at test time | Game of 24: 10% → 99% | **Context collapse**: 18,282 → 122 tokens, ending below baseline |
| **ACE** [A, v3 2026-03] | Generator/Reflector/Curator. **Context stored as itemized bullets with IDs and helpful/harmful counters.** Deltas merged by **non-LLM code**; embedding de-duplication | AppWorld 59.4 vs GEPA 46.4; −82% latency vs GEPA | Brevity bias; needs a strong Reflector; −3.4 without labels |
| **GEPA** [P, ICLR'26 Oral] | Reflects on trajectories in natural language, mutates prompts, keeps a Pareto frontier of candidates | +6 avg over GRPO; up to 35x fewer rollouts | Offline; needs a metric; whole-prompt rewrites tend toward brevity bias |
| MIPROv2 / SIMBA (DSPy) | Instruction and demo search | Up to +13% | Needs labeled data |
| Training-Free GRPO [A] | Semantic advantage → experience library | AIME25 67.9 → 73.3 for $18 | Weaker without ground truth |
| Memento [A] | Case bank + learned retrieval policy | GAIA validation 87.88% Pass@3 | Case bank keeps growing |
| Sleep-time compute [A] | Pre-processes context offline before queries | ~5x less test-time compute | Gains shrink when queries are unpredictable |
| Letta Skill Learning [V] | Reflect on a trajectory → generate a skill | Terminal-Bench +36.8% rel with feedback | One benchmark |

**Newer work (2026)**
- **RIZZ**: only verifier-scored interactions may update memory.
- **SkillsVote**:
  - Updates are gated on evidence: make the **smallest justified edit**, and make no update when the evidence is weak.
  - Skills cause regressions when exposed indiscriminately.
- **ALMA**: a meta-agent searches over memory designs.
- **SpeedRunner**: skills written as programs cut cost the most.
- **Letta "continual learning in token space"**: context is the durable learned artifact; checkpoint it and roll it back.
- **Letta Context-Bench V2**: weaker models **append a 4th dated correction instead of generalizing**, and leave stale contradictions in place.

**Design implications from this evidence:**
1. Store context as small addressable units with counters.
2. Merge changes with deterministic code.
3. Gate updates on verified outcomes.
4. Prefer skills in code form where possible.
5. Natural-language feedback beats scalar scores.

## 2. Memory systems
| System | Model | Scope | Governance |
|---|---|---|---|
| Mem0 | Extract → ADD/UPDATE/DELETE/NOOP reconciliation; optional graph | user/agent/run IDs | None |
| Letta | Agent-editable memory blocks; sleep-time agents | Shared blocks | None; V1 server retired |
| Zep/Graphiti | Bi-temporal knowledge graph; edges invalidated rather than deleted | Namespaces | — |
| **Zep Agent Skills** | Traces → verified runs → proposed skill versions **citing their source runs** | Per agent; publish flow | **Maturity levels provisional/corroborated/established/authored; trust score 0–1**; review optional |
| Cognee | Graph + vector; `improve`; `forget` | "Company Brain" | — |
| Claude memory tool | Client-side `/memories` file operations | Any store | Docs tell you to block traversal, strip sensitive data, cap sizes, expire files |
| Claude Code | CLAUDE.md (managed/project/user/local) + auto memory | **Auto memory is machine-local** | Git review; "context, not enforced configuration" |
| ChatGPT | Saved memories + chat-history reference | Personal | — |
| Cursor | **Memories UI removed** (Jan 2026) | — | Staff advise exporting into Rules |
| Windsurf | Local auto-memories | Local | Docs advise moving durable knowledge to rules or AGENTS.md |
| Devin Knowledge | Suggested from feedback; a human edits or dismisses | Org scope; promote to enterprise | **Being retired in favor of Skills** |
| **Copilot Memory** | Repo facts with **code citations** | Shared with collaborators; **creating them needs write access** | **Citations re-validated before use**; auto votes; **90-day expiry** |
| Glean | Saved + learned memories | **Per user only** | Shows which memories an answer used |

**Benchmarks**
- LongMemEval and LoCoMo are near saturation: vendors report 88–96%.
- MERIT (2026):
  - **Agents act on a correctly retrieved value only 55% of the time.**
  - Swapping the memory implementation moves success by up to 60 points.
- Ground Truth First (2026): a **provenance-typed graph** rises to 90% while curated maps fall to 72%.

**Personal vs organizational memory**
- **Personal:** preferences and role. The owner is the user, and writing automatically is acceptable.
- **Organizational:** definitions, procedures, metrics, policies. These need:
  - an accountable owner;
  - approval;
  - provenance;
  - conflict arbitration;
  - reads that respect access control.
- The research blueprint is **Collaborative Memory** (ICML'25): private and shared tiers, a permission graph, and per-fragment provenance.

## 3. Trace and feedback infrastructure
**OTel GenAI semantic conventions**
- Now in `open-telemetry/semantic-conventions-genai`: Apache-2.0, no release, everything at Development status.
- Join keys:
  - `gen_ai.prompt.name/version`
  - `gen_ai.skill.name`, `gen_ai.skill.source.uri`
  - `gen_ai.memory.record.id`
  - `gen_ai.retrieval.documents{id,score}`
  - `gen_ai.data_source.id`
  - `gen_ai.agent.id/version`
- The `gen_ai.evaluation.result` event has no annotator kind, and there is **no user-feedback event**.
- Content capture is opt-in. The `*_ref` attributes support uploading content to external storage.

**OpenInference** (Apache-2.0)
- Span kinds: RETRIEVER, TOOL, AGENT, EVALUATOR.
- Attributes include `document.id` and `llm.prompt_template.version`.
- Annotations carry `annotator_kind` HUMAN/LLM/CODE.

**Vendors**
- **Langfuse:** feedback stored as scores; annotation queues; **prompt version ↔ generation linking with metrics per version**.
- **LangSmith Insights:** hierarchical clustering of traces.
- **Braintrust Topics:** UMAP + HDBSCAN. The Loop agent proposes prompt versions and reruns evals.
- **Datadog Patterns** (Jun 2026): **flags clusters that have no eval coverage**, and detects drift.
- **Raindrop:** implicit-signal classifiers (frustration, task failure, forgetting); custom signals in plain English.

**Attribution ("blame")**
- **Products** offer exposure statistics only, which are correlational:
  - per prompt version (Langfuse);
  - per rule acceptance rate (Bugbot);
  - per "Never Used" learning (CodeRabbit);
  - per memory vote (Copilot);
  - per skill trust score (Zep);
  - per bullet helpful/harmful counter (ACE).
- **Research:**
  - **ContextCite** (MIT): random ablations plus a sparse linear surrogate; 32 ablations for 98 sources. Needs log-probabilities.
  - AttriBoT: 300x faster leave-one-out (no license).
  - TracLLM: traceback of long contexts for forensics.
  - **Who&When**: 53.5% accuracy at identifying the responsible agent, 14.2% at the decisive step.
  - **AgenTracer** (ICLR'26): counterfactual replay; feeding its attributions back gives +4.8 to +14.2%.
- **Practical synthesis:** attribute in tiers.
  1. Exposure statistics.
  2. An LLM diagnosis.
  3. Counterfactual replay that ablates or swaps one artifact for the top candidates.

  At artifact granularity there are only tens of sources, so ablation is affordable. With API-only models, score the replays with a judge.

## 4. Owner routing in practice
- **Atlan.**
  - Requests route metadata changes to owners, with an inbox and Slack notifications.
  - Owners are filled in automatically from Snowflake `last_ddl_by` and Tableau `source_owner`.
  - Context Engineering Studio flags context repos when upstream assets change.
  - Domain owners arbitrate conflicting definitions, and the rationale is recorded.
  - **It is not driven by traces.**
- **Alation.** Trust flags (endorse/warn/deprecate, with explanations required for the last two); stewards resolve disputes.
- **Guru.** Each card has a verifier and a review interval from weekly to yearly. Cards that go unverified and unused are archived automatically.
- **Glean.** Thumbs feedback is **emailed to a company alias**, not to the document owner.
- **Decagon Duet Autopilot** (Jun 2026):
  - Mines 100% of conversations and proposes fixes to Agent Operating Procedures.
  - Each fix is **simulated against the conversation that surfaced it plus a golden set of hundreds of conversations**, and needs **human sign-off on a diff**.
  - DuetBench-2 [V]:
    - a Fortune 50 customer went from **30% to 55% resolution**;
    - **more than 85% of updates were still live after 30 days**;
    - 70% of merged AOP lines were authored by the AI.
- **Sierra Ghostwriter** (Nov 2026). Review → edit → simulate. Changes wait "until someone reviews and merges them", with required approvals and staged rollouts.
- **Intercom Fin Recommendations.** Reviews unresolved conversations for gaps in content, data or actions, and proposes fixes with impact estimates. One claim of +15% resolution rate [V].
- **Ada.** Classifies each gap as **Knowledge, Action, Coaching or Personalization**, a usable taxonomy for routing.
- **Cursor Bugbot.** Learns rules when PRs merge or close; each rule shows an acceptance rate.
- **CodeRabbit.**
  - Learning scopes: auto, local, global.
  - An **`approval_delay` of 0–30 days** sends learnings to a pending queue.
  - Its guidance: "one-off exceptions should not become learnings".

**Numbers on improvement from these loops:** scarce and vendor-reported. No independent study was found.

## 5. Risks and mitigations
| Risk | Evidence | Mitigations |
|---|---|---|
| Memory poisoning | MINJA 98.2% injection success; AgentPoison: <0.1% poisoned entries → >80% attack success | Gate updates on verifiers; keep provenance boundaries; require write access to create memories |
| Feedback loops amplifying errors | Error propagation; context collapse | Deterministic delta merges, counters, versioned rollback |
| Goodhart on thumbs | GPT-4o sycophancy incident | Use thumbs to triage, not as a target; verify on golden sets; calibrate judges |
| Stale context | Stale contradictions left in place | Re-validate citations, 90-day TTL, verification intervals, flags on upstream changes, edges invalidated rather than deleted |
| Conflicting feedback | Claude "may pick one arbitrarily" | Owner arbitration with a recorded rationale |
| PII in traces | — | Opt-in content capture, `_ref` external storage, redaction |
| Over-generalization | SkillsVote heavy-tailed regressions | Scoped triggers; evals before promotion; durability checks at 7 and 30 days |
| Unlabeled online learning | ACE −3.4 | Learn only from verified outcomes |

## 6. Reusable building blocks
| Item | Repo | License | Reuse |
|---|---|---|---|
| ACE | ace-agent/ace | Apache-2.0 | Bullet schema (ID + counters), Reflector/Curator prompts, deterministic merge. **Re-implement; don't depend.** |
| Dynamic Cheatsheet | suzgunmirac/dynamic-cheatsheet | MIT | Baseline and context-collapse test case |
| **GEPA** | gepa-ai/gepa | MIT | `optimize_anything` to tune skill, metric or ontology text against our evals |
| DSPy | stanfordnlp/dspy | MIT | GEPA/MIPROv2/SIMBA, if we use DSPy modules |
| Graphiti | getzep/graphiti | Apache-2.0 | Bi-temporal edges, provenance. **Backends: Neo4j GPL-3.0, FalkorDB SSPL, Kuzu archived** |
| Mem0 | mem0ai/mem0 | Apache-2.0 | Reconciliation for the personal-memory tier |
| Letta | letta-ai/letta-code | Apache-2.0 | Memory blocks, sleep-time agents, skill learning |
| Cognee | topoteretes/cognee | Apache-2.0 | improve/forget; COGX import format |
| **Langfuse** | langfuse/langfuse | MIT except `ee/` | OTLP ingestion, scores, annotation queues, version ↔ trace linking, datasets from traces |
| Phoenix | Arize-ai/phoenix | **ELv2: blocks offering it as a service** | Internal use only |
| **OpenInference** | Arize-ai/openinference | Apache-2.0 | Instrumentors, span kinds, annotation spec |
| **OTel GenAI conventions** | open-telemetry/semantic-conventions-genai | Apache-2.0 | **Our span schema** |
| ContextCite | MadryLab/context-cite | MIT | Ablation + Lasso surrogate, applied per artifact |
| Who&When | mingyin1/Agents_Failure_Attribution | MIT | Data and baselines to evaluate our attributor |
| Not reusable | AttriBoT, AgenTracer | **No license** | — |

## 7. Reference design: a feedback-to-fix loop
1. **Instrument exposure.** Every span records each artifact it used, with ID and version (OTel keys plus a custom `context.artifact.{id,version,kind,owner}`). Content stays opt-in and goes to `_ref` storage with redaction.
2. **Capture signals.**
   - Explicit: thumbs and comments.
   - Implicit: reformulations such as "I actually wanted it by segment".
   - Evals: `gen_ai.evaluation.result`.
3. **Decide scope.** One user's preference becomes personal memory. Only candidates that recur across users go to the org path.
4. **Cluster**, requiring a threshold before routing: several distinct users, or a severity override. Flag clusters that have no eval coverage.
5. **Attribute in tiers.**
   1. Exposure statistics.
   2. An LLM diagnosis with Ada's taxonomy: defect, gap, preference, or agent error.
   3. Counterfactual replay that ablates the top candidate artifacts.
   - "No responsible artifact" means a gap, which goes to the domain owner.
6. **Route** through an owner registry, falling back to the domain owner, then to an unowned queue. Send weekly digests.
7. **Draft the smallest fix** as an ACE-style itemized delta or a structured diff. GEPA can tune text artifacts.
8. **Validate.** Replay the traces that surfaced the issue plus a golden set, and check for conflicts with other artifacts. Require improvement on the cluster and no regressions elsewhere.
9. **Owner approves**, with a gate tiered by risk.
10. **Ship** with a staged rollout, and notify the users who gave the feedback.
11. **Monitor.**
    - Durability at 7 and 30 days.
    - Counters, with auto-demotion past a downvote threshold.
    - TTL with re-verification.
    - One-click rollback.
    - Add the replayed traces to the eval set.

**Worked example.** Q3 NRR → "I wanted it by segment".
- The trace shows exposure to `nrr@v3` (owner: FP&A).
- 23 similar follow-ups from 9 users.
- Diagnosis: a missing-dimension gap.
- Diff: add `segment` to the metric definition.
- Replay and regression evals pass.
- `nrr@v4` ships, and the 9 users are notified.

## 8. Top 8 open problems
1. Attributing a failure to the responsible artifact. There is no benchmark for "which context artifact caused this".
2. Telling defect from preference from gap, and choosing the scope of a fix.
3. Aggregating conflicting feedback without Goodharting.
4. Poisoning through shared feedback channels.
5. Validating fixes without ground truth.
6. Interference and bloat as artifacts accumulate.
7. Standards gaps. OTel has no owner or feedback attributes.
8. Organizational learning from personal traces while preserving privacy, plus owner fatigue. "Compounding" itself is still unmeasured.
