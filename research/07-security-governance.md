# Security and governance of agent context: attacks, defenses, requirements

*Researched 2026-11-05. Items marked [nr] came from prior knowledge and were not re-verified. Everything else was checked against the linked source.*

## 0. Main findings
- In 2025–2026, plain-text context became a working supply-chain attack vector. That covers SKILL.md, AGENTS.md/CLAUDE.md, rules files, MCP tool descriptions and memory. The evidence:
  - real campaigns with more than 1,000 malicious skills;
  - CVEs in every major coding agent;
  - the first malicious MCP server found in the wild.
- Scanners help but miss most attacks:
  - Cisco's own scanner caught 7.7% of malicious skills with rules alone, and 33.7% with an LLM judge.
  - Five malicious skills got past ClawHub's VirusTotal+ClawScan screening.
  - So treat scanning as one gate, not a guarantee.
- The defenses that hold up are architectural:
  - signed, pinned content;
  - trust tiers;
  - least-privilege distribution;
  - capability limits (Rule of Two / lethal trifecta);
  - quarantine for anything derived from untrusted input, including feedback from traces.

## 1. Attacks on agent context, 2025–2026

### 1.1 Malicious skills in public registries
| Event | Date / researcher | Specifics |
|---|---|---|
| **ClawHavoc** (OpenClaw/ClawHub) | Koi Security, first disclosed 2026-02-01 ([Koi](https://www.koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting), [CyberSecurityNews](https://cybersecuritynews.com/clawhavoc-poisoned-openclaws-clawhub/)) | <ul><li>341 malicious skills out of 2,857 audited; later more than 824 as the registry grew past 10,700.</li><li>335 used fake "prerequisites" to install Atomic macOS Stealer.</li><li>Typosquats such as `clawhubb`.</li><li>Any GitHub account older than one week could publish.</li></ul> |
| Antiy CERT follow-up | 2026-02-06 ([Antiy](https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/)) | <ul><li>**1,184** malicious skills from 12 accounts; one account published 677.</li><li>Techniques: ClickFix-style "Setup" sections, base64 one-liners from paste sites, password-protected ZIPs, reverse shells, `.env` exfiltration.</li></ul> |
| **Snyk ToxicSkills** | 2026-02-05 ([Snyk](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)) | <ul><li>Scanned 3,984 skills from ClawHub and skills.sh: 36.82% had at least one flaw, 13.4% had a critical issue, and **76 were confirmed malicious**.</li><li>91% of the malicious ones combined prompt injection with malware.</li><li>Techniques: Unicode smuggling, `curl \| bash` remote instruction loading.</li></ul> |
| Academic census | 2026-02-06, v4 2026-06-10 ([arXiv 2602.06547](https://arxiv.org/abs/2602.06547)) | <ul><li>98,380 skills; 157 malicious; 632 vulnerabilities across 13 techniques.</li><li>More than half came from one actor.</li><li>The most advanced attacks abuse "platform-native trust mechanisms".</li></ul> |
| Scanner evasion | 2026-06-23 ([Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/)) | 5 malicious skills passed ClawHub's VirusTotal+ClawScan screening. |

### 1.2 Instruction and rules files
- **Rules File Backdoor.** Pillar Security, 2025-03-18 ([Pillar](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents)).
  - Zero-width and bidi characters hide instructions in `.cursor/rules` and `copilot-instructions.md`.
  - The hidden text does not show in the editor or in PR review.
  - GitHub added a hidden-Unicode warning on 2025-05-01. MITRE ATLAS lists it as case study AML.CS0041.
- **Planted AGENTS.md / CLAUDE.md.** Forever Security, reported 2026-10-26 ([THN](https://thehackernews.com/2026/10/malicious-file-in-downloads-folder.html)).
  - A web page can drop a file into ~/Downloads.
  - An attacker AGENTS.md got Codex to register a server and install a malicious npm package in more than 90% of runs.
  - A CLAUDE.md variant got approval to write an attacker `ANTHROPIC_BASE_URL` about half the time.
- **CamoLeak.** Legit Security, CVSS 9.6, Oct 2025 ([Legit](https://legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code)). Invisible markdown comments in PRs made Copilot Chat leak private code through the Camo image proxy.

### 1.3 Config-file CVEs in coding agents
- **Claude Code** ([Check Point, 2026-02-25](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)):
  - Hooks in `.claude/settings.json` ran commands without confirmation (fixed 2025-08-26).
  - CVE-2025-59536: MCP servers started before the trust dialog.
  - CVE-2026-21852: a project-level `ANTHROPIC_BASE_URL` sent the API key out before consent.
- **Cursor** ([THN](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html)):
  - CVE-2025-54135 "CurXecute".
  - CVE-2025-54136 "MCPoison": an approved MCP config could later be swapped without re-approval.
- **Copilot / VS Code.** CVE-2025-53773: prompt injection wrote `"chat.tools.autoApprove": true`, which led to RCE.
- **Nx "s1ngularity".** 2025-08-26 ([Orca](https://orca.security/resources/blog/s1ngularity-supply-chain-attack/)). Malware ran installed coding agents with `--yolo` to hunt for secrets; 2,349 secrets leaked.

### 1.4 MCP tool poisoning, rug pulls, shadowing
- **Invariant Labs** ([2025-04-01](https://invariantlabs.ai/blog/mcp-security-notification)):
  - Tool poisoning: hidden instructions in a tool description made the agent read `~/.ssh/id_rsa`.
  - MCP-Scan introduced *tool pinning*, which hashes tool definitions so a rug pull is detected.
  - Shadowing: one server's tool description changes how the agent uses another server's tool.
- **GitHub MCP data leak** ([2025-05-26](https://invariantlabs.ai/blog/mcp-github-vulnerability)). Injected text in a public issue got private-repo data copied into a public PR.
- **Supabase MCP** ([Willison 2025-07-06](https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/)). The agent ran as `service_role` and read a support ticket that contained instructions. That gives all three lethal-trifecta legs from one server.
- **postmark-mcp 1.0.16** (2025-09-17). After 15 clean versions, one added line BCC'd every email to the attacker: a textbook rug pull.
- **EchoLeak.** CVE-2025-32711, zero-click: an injection carried in by a retrieved email exfiltrated M365 data.

### 1.5 Memory poisoning
- **ChatGPT "SpAIware"** ([2024-09-20](https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/)). Injected memories exfiltrated every later conversation.
- **Gemini** "delayed tool invocation" ([2025-02-10](https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/)). A document plants a memory write that looks user-initiated.
- **Microsoft "AI Recommendation Poisoning"** ([2026-02-10](https://www.microsoft.com/en-us/security/blog/2026/02/10/ai-recommendation-poisoning/)). Links told assistants to remember a vendor as a trusted source. Microsoft found 50 attempts from 31 companies in 60 days.

### 1.6 Retrieval poisoning and the lethal trifecta
- **PoisonedRAG** ([USENIX Sec 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/zou)). Five crafted texts per target question reach about 90% attack success.
- **Lethal trifecta** ([Willison 2025-06-16](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)): private data + untrusted content + external communication. Avoid the combination.

**What this means for a context platform.** Every attack above has a direct equivalent in a shared context layer:
- A poisoned skill or AGENTS.md entry is ClawHavoc or Rules File Backdoor.
- An artifact changed after approval is MCPoison or postmark-mcp.
- Distributed settings that change base URLs, hooks or auto-approve are CVE-2026-21852 or CVE-2025-53773.
- Feedback written back from traces is memory poisoning or PoisonedRAG at organisational scale.

## 2. Defenses and standards
- **OWASP Top 10 for LLM Apps 2025.**
  - Key items: LLM01 Prompt Injection, LLM03 Supply Chain, LLM04 Poisoning, LLM06 Excessive Agency, LLM08 Vector & Embedding Weaknesses.
  - LLM08 recommends permission-aware vector stores.
- **OWASP Top 10 for Agentic Applications 2026** ([2025-12-09](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)). The ones that matter most here are **ASI04 Agentic Supply Chain** and **ASI06 Memory & Context Poisoning**.
- **OWASP Agentic Skills Top 10** ([site](https://owasp.github.io/www-project-agentic-skills-top-10/)).
  - It includes **AST07 Update Drift**.
  - It proposes skill-format fields: `signature`, `content_hash`, `scan_status`, a network allowlist, and `deny_write`. This is the closest existing schema for our platform.
- **MITRE ATLAS** technique AML.T0080 (AI Agent Context Poisoning).
- **NIST COSAIS** SP 800-53 overlays for single- and multi-agent systems.
- **CoSAI** MCP Security paper, 2026-01-27.
- **Signing.**
  - [OpenSSF model-signing v1.0](https://blog.sigstore.dev/model-transparency-v1.0) signs a **directory tree** (DSSE + in-toto). A skill bundle is also a directory tree, so this applies directly.
  - [nono](https://nono.sh/provenance) already signs CLAUDE.md/AGENTS.md/skills with Sigstore and enforces a `trust-policy.json`.
  - The MCP Registry does not sign or scan.
- **Vendor guidance.** Anthropic's [enterprise skills guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise) calls for:
  - risk tiers;
  - separation of duties;
  - pinned versions, because unpinned means "a new version uploaded by anyone ... immediately changes what production agents run";
  - checksums.

  Codex loads project config only for trusted projects.
- **Design patterns:**
  - [Meta Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) (2025-10-31).
  - [Design Patterns for Securing LLM Agents](https://arxiv.org/abs/2506.08837) (June 2025).
  - [CaMeL](https://arxiv.org/abs/2503.18813) solves 77% of AgentDojo tasks with provable security.

### Reusable components
| Component | Repo | License | What to reuse |
|---|---|---|---|
| Cisco skill-scanner | [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) | Apache-2.0 | YARA-X rules, AST/taint analysis, SARIF output, GitHub Action |
| Cisco mcp-scanner | [cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner) | Apache-2.0 | Tool, prompt and resource poisoning checks |
| Snyk agent-scan | [snyk/agent-scan](https://github.com/snyk/agent-scan) | Apache-2.0 client | Skill/MCP discovery. **Analysis needs Snyk's API, so data leaves the machine.** |
| Invariant Guardrails | [invariantlabs-ai/invariant](https://github.com/invariantlabs-ai/invariant) | Apache-2.0 | Template for tool-flow policy rules |
| LLM Guard | [protectai/llm-guard](https://github.com/protectai/llm-guard) | MIT, **archived** | Copy the InvisibleText/Secrets logic; don't depend on it |
| LlamaFirewall | [PurpleLlama](https://github.com/meta-llama/PurpleLlama/tree/main/LlamaFirewall) | MIT code | Regex scanners. **The Prompt Guard model weights are under the Llama license (not OSI).** |
| Promptfoo | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | MIT | Red-team and regression harness (now part of OpenAI) |
| OpenSSF model-signing | [sigstore/model-transparency](https://github.com/sigstore/model-transparency) | Apache-2.0 | Sign and verify directory bundles |
| sigstore / cosign / in-toto | sigstore | Apache-2.0 | Keyless signing, transparency log |
| nono | [nolabs-ai/nono](https://github.com/nolabs-ai/nono) | Apache-2.0 | Trust-policy format for instruction files |
| OPA / Rego | [open-policy-agent/opa](https://github.com/open-policy-agent/opa) | Apache-2.0 | Distribution and promotion policies |
| Cedar | [cedar-policy/cedar](https://github.com/cedar-policy/cedar) | Apache-2.0 | Which-agent-reads-which-artifact authorization |
| Presidio | [microsoft/presidio](https://github.com/microsoft/presidio) | MIT | PII redaction of traces |

**License flags:**
- TruffleHog is AGPL-3.0; use Gitleaks (MIT) instead.
- Avoid embedding ELv2/SSPL/BSL infrastructure.

**Hidden-Unicode detection** is easy to write ourselves. Reject or flag:
- Unicode category Cf;
- the Tags block U+E0000–E007F;
- bidi controls U+202A–202E and U+2066–2069;
- zero-width characters U+200B–200D, U+2060, U+FEFF;
- variation selectors.

Also strip HTML/markdown comments (the CamoLeak lesson).

## 3. Governance of enterprise context
- **Glean** copies source ACLs into its index, with indexed, live or hybrid permission checks. The gap is stale ACLs.
- **Microsoft 365 Copilot** only uses content the user is authorized to see. Generated content inherits the highest sensitivity label, and Purview audits the content referenced.
- **Atlan's MCP server lets agents change certification status.** A write path like that needs a human gate.
- **EU AI Act** dates:
  - GPAI obligations apply from 2025-08-02.
  - Art. 50 transparency applies from 2026-08-02.
  - The Digital Omnibus (Reg. 2026/1744) moved Annex III high-risk obligations to 2027-12-02.
- **OTel GenAI** content capture is opt-in, and the conventions are still at Development status. Redact at source.
- **Harm cases:**
  - [Moffatt v. Air Canada](https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do), 2024-02-14: the chatbot invented a bereavement rule and the airline was liable.
  - Cursor's support bot "Sam" invented a policy (Apr 2025).
  - 1,624 court cases with hallucinated citations by 2026-06.
  - Deloitte Australia refunded part of an A$440k report (Oct 2025).

## 4. Security checklist for an open context layer
1. **MUST** sign every published artifact and verify it on the client. Unsigned means not loaded.
2. **MUST** address artifacts by content digest. Consumers pin digests, and a change needs re-approval.
3. **MUST** carry the trust tier as a signed attribute: Certified, Reviewed, Imported, or Proposal.
4. **MUST** require two-person review (author ≠ approver) for the Certified tier and for any artifact with scripts or URLs.
5. **MUST** reject hidden Unicode and HTML comments at ingestion, and show reviewers the exact bytes the model receives.
6. **MUST** run multi-engine scanning and store the results as attestations. A clean scan is never certification.
7. **MUST** require a capability manifest for skills and tools, enforced by policy-as-code.
8. **MUST** enforce least-privilege distribution: per-artifact ACLs and per-agent profiles.
9. **MUST NOT** distribute execution-affecting config (hooks, base URLs, auto-approve, MCP registrations, env vars) through the context channel by default.
10. **MUST** quarantine changes derived from feedback or traces as proposals, with provenance, review and evals.
11. **MUST** prevent agents from writing certification status or Certified-tier content.
12. **MUST** keep a tamper-evident, append-only history plus a distribution audit log.
13. **MUST** support fast revocation: a digest denylist pushed to clients, and notice to everyone who received the artifact.
14. **MUST** redact PII and secrets from traces, make content capture opt-in, and apply TTLs.
15. **MUST** version policies alongside content and log every policy decision.
16. **SHOULD** check each agent's assembled context against the Rule of Two / lethal trifecta.
17. **SHOULD** attach SLSA-style build provenance to releases.
18. **SHOULD** serve certified items with stable IDs, version and owner so agents can cite them.
19. **SHOULD** run a red-team regression suite on every Certified release and every model change.
20. **SHOULD** support residency tags and keep the evidence the EU AI Act asks for.
21. **SHOULD** mark untrusted content so it cannot drive tool calls on its own.
22. **SHOULD** check dependency licenses in CI.
23. **SHOULD** watch the external URLs that artifacts reference, and rescan when they change.
