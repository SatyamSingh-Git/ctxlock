# Evidence: which context shapes actually work for agents

*Researched 2026-11-05 from about 55 primary sources.*
- *Unverified: Atlan's "5x" claim; Cloudflare's later Code Mode token figures; Fiction.LiveBench scores at each context length.*
- *Spot-check any figure before putting it on a slide.*

## 0. Where the keynote's numbers come from
| Keynote figure | Source | What it really is |
|---|---|---|
| 46% of agents open a given skill | SkillsBench v4 (arXiv 2602.12670), Table 14 | <ul><li>Invocation ranges from **46% to 99%**.</li><li>46.4% is OpenHands + Gemini 3.1 Flash Lite (the weakest config).</li><li>Codex + GPT-5.5: 99.2%. Claude Code + Opus 4.7: 68.2%.</li></ul> |
| 49% load all needed skills; 31% with distractors | Liu et al. arXiv 2604.04323 | Claude Opus 4.6 only |
| Success 51% → 44% with distractors | Same paper | 51.2% → 43.5%, with the pool capped at 5 skills |
| Vercel 53% vs 100% | Vercel, Jan 2026 | Baseline 53%, skill 53%, skill + instruction 79%, AGENTS.md **index** 100% |

## 1. Skills vs always-on context vs retrieval
**Vercel, "AGENTS.md outperforms skills"** ([post](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals))
- Next.js 16 APIs that are absent from training data.
- The skill was not invoked in 56% of cases. An explicit instruction pushed triggering to 95%+.
- Build/lint/test: baseline 84/95/63 vs AGENTS.md 100/100/100.
- **The AGENTS.md was a pipe-delimited 8KB index**, compressed from 40KB with no loss, pointing at `.next-docs/` files on disk. It included the line "Prefer retrieval-led reasoning over pre-training-led reasoning."
- Wording mattered:
  - "MUST invoke skill" made the agent read docs first and miss `next.config.ts`.
  - "Explore project first, then invoke skill" did better.
- Caveats: model not named, no n, no variance reported.
- Open: `vercel/next-evals-oss` (MIT).

**SkillsBench v4** (77 authors, Dawn Song; Feb–Jun 2026)
- 87 tasks, 18 model × harness configurations, 3 trials, about 9.4k trajectories.
- Curated skills: 33.9% → **50.5%**.
- **Self-generated skills: −8.1 to −11.5pp.** In 10 of 12 audits the agent never read the skills it wrote.
- By skill count: 1 skill +18.0; 2–3 skills +19.0; 4+ skills +10.1.
- By length: compact +19.0; standard +21.5; detailed +14.5; **comprehensive +0.7**.
- 13 of 87 tasks have negative deltas.
- **The harness changes invocation:** Gemini 3.1 Pro invokes 90.4% in Gemini CLI vs 54.0% in OpenHands.
- Open: `benchflow-ai/skillsbench` (**Apache-2.0**). Each task has task.md, environment/skills, an oracle and a verifier. Run with `bench eval run --skill-mode with-skill`.

**Liu et al. 2604.04323** (Claude Code + Opus 4.6; Kimi K2.5; Qwen3.5)
- Claude pass rates:

  | Setting | Pass rate |
  |---|---|
  | Curated, force-loaded | 55.4% |
  | Curated, agent picks | 51.2% |
  | Curated + distractors | 43.5% |
  | Retrieved, curated included | 40.1% |
  | Retrieved, curated excluded | 38.4% |
  | No skills | 35.4% |

- Kimi and Qwen fell **below** their no-skill baselines in the realistic setting.
- Claude used a skill in only 16% of runs in the most realistic setting.
- Skill retrieval Recall@5: semantic 47.0; agentic keyword 26.6; **agentic hybrid with content 65.5**.
- Query-specific refinement recovers part of the loss: 40.1 → 48.2. On Terminal-Bench 2.0 it took Claude from 57.7 to 65.5.
- Open: `UCSB-NLP-Chang/Skill-Usage` (**MIT**), with a 34k-skill pool on Hugging Face.

**ETH Zurich / LogicStar, "Evaluating AGENTS.md"** (arXiv 2602.11988)
- SWE-bench Lite plus 138 new instances.
- **LLM-generated context files:** −0.5pp to −2pp. Sonnet-4.5 went 73.2 → 65.2 on the new set.
- **Developer-written files:** +2.4pp.
- The only significant success difference is developer vs LLM-written files (p=0.038).
- **Cost (significant):** +20–23% and +2.45 to 3.92 steps.
- Instructions are obeyed: `uv` used 1.6x per instance when mentioned vs under 0.01 when not.
- Repository overviews did not reduce steps. LLM-written files helped (+2.7%) only once the repo's own docs were stripped, so **they mostly duplicate what is already discoverable.**
- Open: `eth-sri/agentbench` (**MIT**), with NONE/LLM/HUMAN settings and a dataset generator.

**Conflicting evidence on AGENTS.md**
- Lulla et al. (2601.20404): runtime −28.64%, output tokens −16.58%. Measures output tokens, not total cost.
- McMillan (2605.10039), 1,650 Claude Code sessions:
  - **File size, position, architecture and contradictions had no detectable effect** on following a trivial rule.
  - Drift within a session did: compliance odds fell about 5.6% per extra generated function.

**Other skill studies**
- **Demystifying Agent Skills** (2608.14036)
  - Skills work mainly by **procedural anchoring** (65.7%), not knowledge injection (4.5%).
  - As the pool grows from 5 to 100, actual-use precision falls 29.6% → 3.3%, but success *rose* slightly (36.4 → 39.3). **This conflicts with Liu.**
- **WebDev-Skills-Bench** (2608.23067)
  - Injecting the target skill **lowered Pass@2 by 1.3–4.2%** and raised token cost by **72–394%**. Skills helped in only 17–36% of skill–project pairs.
  - **Anti-pattern rules beat example-heavy content.**
- **Agent Skills Can Be Harmful** (2608.11888)
  - 307 failures. The top cause is "Excessive Procedure", including excessive verification.
  - **Relevant-looking** skills cause most functional failures.
- **Anthropic skill-creator**
  - Claude tends to undertrigger skills, so make descriptions "pushy".
  - The optimizer: 20 queries, 60/40 split, 3 runs each, 5 iterations. It improved triggering on 5 of 6 skills.
  - About 100 words of metadata stay always on; keep SKILL.md under 500 lines.
- **Scott Spence (small n)**
  - No hook: 50–55% activation. Forced-eval hook: 100%.
  - On harder prompts: forced-eval 75%, llm-eval 67% with 4 false positives.

## 2. Context degradation
- **Chroma "Context Rot"** (18 models; `chroma-core/context-rot`, MIT)
  - Degradation grows with length, and faster when the needle is less similar to the question.
  - One distractor hurts and four compound it.
  - Shuffled haystacks beat coherent ones.
  - LongMemEval: a focused prompt of about 300 tokens beats the full 113k tokens on all models.
- **Lost in the Middle**
  - GPT-3.5 with 20 documents: 75.8% at position 1, **53.8% at position 10**, 63.2% at position 20.
  - Closed-book scores 56.1%, so the middle position is worse than no context.
  - Going from 20 to 50 documents adds about 1.5%.
- **NoLiMa** (ICML 2025; **non-commercial license**)
  - 11 of 13 models claiming 128K+ fall below half their short-context score at 32K.
  - Effective lengths: GPT-4.1 16K, GPT-4o 8K, Claude 3.5 Sonnet 4K.
- **RULER** (NVIDIA, Apache-2.0): only about half of models claiming 32K+ hold up at 32K.
- **Du et al., EMNLP 2025**
  - Performance drops 13.9–85% as input grows, **even with perfect retrieval and even when the padding is whitespace**.
  - Reciting the evidence first gives up to +4%.
- **Databricks long-context RAG**
  - Accuracy peaks, then declines: about 32k for Llama-405B, 64k for GPT-4, 16k for Claude-3-Sonnet.
  - Claude-3-Sonnet refusals rise from 3.7% to 49.5%.
- **Long context vs RAG** (Google DeepMind, EMNLP 2024)
  - Long context wins on average.
  - Self-Route (RAG first, long context only when needed) uses 38–61% of the tokens.
- **Breunig's failure modes: poisoning, distraction, confusion, clash.**
  - Llama 3.1 8B failed with 46 tools but succeeded with 19.
  - Laban et al.: **−39% when instructions are spread across turns**; o3 98.1 → 64.1 (`microsoft/lost_in_conversation`, MIT).

## 3. Tool count and tool loading
- **Anthropic "Advanced tool use"** (Nov 2025)
  - 58 tools take about 55K tokens.
  - Tool Search Tool: −85% tokens. Accuracy Opus 4 **49 → 74%**, Opus 4.5 79.5 → 88.1%. Recommended above 10 tools or 10K tokens.
  - Programmatic tool calling: −37% tokens, +3 to +5pp.
  - Tool use examples: 72 → 90% on complex parameters.
  - Claude Code warns when MCP output reaches 10K tokens and caps it at 25K.
- **"Code execution with MCP" 98.7%**: an illustrative example, not a benchmark.
- **Cloudflare Code Mode**: no quantitative eval.
- **RAG-MCP**
  - Tool-selection accuracy 13.62% → 43.13%.
  - Success holds above 90% while the target is within about the first 30 positions; past about 100, failures dominate.
- **Anthropic "Writing tools"**: concise responses about 72 tokens vs about 206; namespacing helps.

## 4. Agentic search vs RAG, and context engineering
- **Claude Code**: moved from embeddings to grep. "Outperformed everything. By a lot." The evidence is "mostly vibes".
- **Cursor** (counter-evidence)
  - Semantic search +12.5% accuracy; grep plus semantic search is best.
  - Agentic *keyword* search was worst at finding skills (R@5 26.6).
- **Manus**
  - **KV-cache hit rate is the #1 metric** (cached input $0.30 vs $3 per MTok).
  - About 100:1 input-to-output ratio.
  - Mask tools rather than removing them; use the file system as restorable memory; recite goals in todo.md; keep errors in context.
- **Anthropic context engineering**
  - "Smallest possible set of high-signal tokens".
  - Just-in-time references; compaction; NOTES.md; sub-agents return 1–2K-token summaries.
  - Context editing +29%, +39% with memory, −84% tokens.
- **Multi-agent**
  - Anthropic: +90.2% at about 15x tokens; tokens explain 80% of variance.
  - Cognition argues for single-threaded agents.
  - They don't really conflict: isolate parallel reads, keep coupled writes in one thread.
- **ACE** (ICLR 2026)
  - +10.6% on agent tasks via delta updates.
  - **Context collapse:** a full rewrite shrank 18,282 tokens to 122 and dropped accuracy *below* baseline (66.7 → 57.1, baseline 63.7).

## 5. Business context for data agents
- **BIRD** (CC BY-SA)
  - Adding per-question evidence: GPT-4 34.88 → 54.89 (**+20pp**).
  - Top of the leaderboard 83.40 vs human 92.96. BIRD-Interact best is 16.33%.
- **data.world** (`datadotworld/cwd-benchmark-data`, Apache-2.0)
  - Raw SQL 16.7% vs KG/SPARQL **54.2%**.
  - Ontology check plus repair: **72%**, with 8% "I don't know".
- **dbt Semantic Layer**: 83%, but on only **8 questions**.
- **Snowflake Cortex Analyst**: 90%+ vs 51% (internal, 150 questions).
- **Spider 2.0** (MIT)
  - **Schema linking accounts for 27.6% of errors.**
  - Few-shot examples were marginal (+1pp). Oracle docs had mixed effects.
- **LinkedIn SQL Bot**
  - Context layers: certified tables, expert descriptions, example queries, crowdsourced jargon, query-log popularity.
  - Retrieve 20 tables, re-rank to 7.
- **Atlan "5x": not substantiated.**
- **Ranking of context types (synthesis):**
  1. Value-level definitions.
  2. Certified metrics and ontologies.
  3. Validation plus repair plus abstention.
  4. Schema linking and table retrieval.
  5. Few-shot examples (weakest).

## 6. Format effects
- He et al.: up to **40%** variance across formats. The best format doesn't transfer across model families (IoU < 0.2).
- Sclar et al.: spurious formatting swings accuracy by up to **76 points**.
- Flat records: Markdown-KV 60.7% > XML 56.0% > YAML 54.7% > JSON 52.3% > CSV 44.3%.
- Nested data: YAML is best for GPT-5 Nano and Gemini Flash Lite; XML is worst.
- **OpenAI GPT-4.1**
  - JSON is "particularly poor" for many documents; XML and pipe formats do well.
  - Put instructions above the context, or at both ends.
- **Anthropic**: put data at the top and the query at the end, worth up to +30%. **This conflicts with OpenAI's advice. Placement is model-specific.**
- **IFScale**
  - At 500 instructions: Gemini 2.5 Pro 68.9%, o3 62.8%, Opus 4 44.6%.
  - Reasoning models hold until about 150–250 instructions. There is a primacy bias, and omissions dominate.
- **Examples vs rules: conflicting evidence.** Tool use examples help (72 → 90), while anti-pattern rules beat examples in skills.

## Reusable harnesses
| Harness | Repo | License |
|---|---|---|
| SkillsBench | benchflow-ai/skillsbench | Apache-2.0 |
| Skill-Usage (Liu et al.) | UCSB-NLP-Chang/Skill-Usage | MIT |
| AGENTS.md study | eth-sri/agentbench | MIT |
| Vercel Next.js evals | vercel/next-evals-oss | MIT |
| Context Rot | chroma-core/context-rot | MIT |
| RULER | NVIDIA/RULER | Apache-2.0 |
| Lost in the Middle | nelson-liu/lost-in-the-middle | MIT |
| Lost in Conversation | microsoft/lost_in_conversation | MIT |
| Spider 2.0 | xlang-ai/Spider2 | MIT |
| data.world benchmark | datadotworld/cwd-benchmark-data | Apache-2.0 |
| dbt Semantic Layer benchmark | dbt-labs/semantic-layer-llm-benchmarking | Apache-2.0 |

**Restricted:**
- BIRD: CC BY-SA.
- NoLiMa: non-commercial.
- IFScale: no license stated.

## 20 evidence-based design rules for agent-native context
1. **Keep a compact index always on, and content on demand.** (Vercel 8KB index 100% vs skills 53–79%)
2. **Never make critical context depend on the model choosing to fetch it.** If it's needed on most tasks, load it passively or route it with a hook. (56% never invoked; invocation 46–99%; hooks took activation from 50% to 100%)
3. **Measure discovery separately from success, for each model and harness.** (90.4% vs 54.0% for the same model in different harnesses)
4. **Keep candidate pools small and well separated; remove near-duplicates.** (51.2 → 43.5. Conflicting evidence: Demystifying.)
5. **Curate; don't auto-generate.** (Self-generated −8 to −11.5pp; LLM AGENTS.md −2pp at +20% cost; context collapse)
6. **Use 1–3 focused modules of standard length.** (Comprehensive +0.7 vs standard +21.5; +72–394% tokens)
7. **Ship only what the agent can't discover**: conventions, required tools, constraints. Not repo overviews. (ETH)
8. **Treat every token as an accuracy cost.** Assume an effective window of 2–16K for retrieval that needs inference. (NoLiMa; Du et al.; Chroma)
9. **Place critical items deliberately: data first, task last; recite goals.** (Anthropic +30%. OpenAI conflicts, so test per model.)
10. **Defer tool loading beyond about 10 tools or 10K tokens; append tools rather than changing them, to keep the KV cache warm.** (49 → 74; RAG-MCP; Manus)
11. **Process bulk data in code and return digests.** (−37% tokens)
12. **Make responses concise by default**: resolve IDs to names, paginate, cap size, make errors actionable. (72 vs 206 tokens)
13. **Offer hybrid lexical plus semantic retrieval, driven by the agent.** (Cursor +12.5%; hybrid R@5 65.5)
14. **Use the file system as restorable memory; compact by delta.** (Manus; +29/+39%; ACE)
15. **Isolate only parallel read-heavy work; return 1–2K-token summaries.**
16. **For data agents, ship metric definitions, value glossaries and join paths as governed objects, and validate before executing.** (BIRD +20pp; KG 16.7 → 54.2; 72% with abstention)
17. **Treat schema linking as the main bottleneck**: retrieve, then re-rank to a handful of tables. (27.6% of errors)
18. **Choose formats by eval, not belief.** Defaults: Markdown or XML for instructions; YAML or Markdown-KV for records; avoid JSON for large document collections. (40–76pt swings)
19. **Budget always-on rules (under about 100–150 for frontier models); prefer constraints and anti-patterns over mandatory procedures.** (IFScale; excessive procedure is the top skill failure)
20. **Ship every artifact as a hypothesis with a paired eval**: with vs without, a length-matched control, per model and per harness. (SkillsBench; WebDev; McMillan nulls)

**Where the evidence is weak:**
- Vendor numbers rarely give n or variance.
- Semantic-layer studies are tiny (8 to 150 questions).
- Results on distractors and on examples vs rules conflict.
- Results may shift as models update.
