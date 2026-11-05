# Competitive landscape, the filesystem trend, and the name check

*Researched 2026-11-05.*
- *Star counts and licenses come from the GitHub API on 2026-11-05. npm downloads are for the last 30 days.*
- *Unverified: Kontext's identity; funding for Credal, Writer and Pieces; trademarks.*
- *This report missed **Atlan's AI Registry spec** (Apache-2.0, v0.1, [atlanai/ai-registry](https://github.com/atlanai/ai-registry)). It is covered in 01, and it belongs in this landscape as a direct comparable. See also Langfuse Skills and Promptless in 04.*

## 1. Landscape
**License key**
- **embed-OK**: permissive license. Code can be vendored, forked or embedded.
- **interop-only**: AGPL, ELv2 or proprietary. Talk to it over a boundary; never vendor its code.

**Score**: closeness to our vision, from 1 to 5.

| Name | Category | Artifacts | Consumption | License | Funding / traction | Score |
|---|---|---|---|---|---|---|
| **Packmind** | Context governance for coding agents | Standards, commands, skills | Writes CLAUDE.md, `.mdc`, copilot-instructions and AGENTS.md; CLI | Apache-2.0 core, embed-OK. Paid tier holds enforcement, governance and RBAC. 321★ | About $1M pre-seed (unverified); about 2k npm/mo; logos include Sopra Steria, Ubisoft, Allianz | **4** |
| **Tessl** | Skills package manager, registry and evals | Skills ("tiles"), specs, `tessl.json` | CLI | Closed; CLI license "Other" (interop-only) | $125M raised; 17k npm/mo | **4** |
| **Atlan AI Registry** | Open spec for a skills/agents registry plus `aireg` CLI | Skills, agents; MCP and metrics planned | Syncs to Claude Code, Codex, Cursor | Apache-2.0. About 167★, v0.1 | Backed by Atlan | **4** |
| **rulesync** | Context compiler | Rules, commands, MCP, ignore files, subagents, skills | Generates per-tool files | MIT, embed-OK. 1,584★ | **1.14M npm/mo** | 3 |
| **Ruler** | Context compiler | `.ruler/` rules, MCP, skills, subagents | 20+ agent targets; CI drift check | MIT, embed-OK. 2,960★ | 339k npm/mo | 3 |
| **Context Hub** (Andrew Ng, `chub`) | Docs for agents with a feedback loop | Versioned API docs, annotations, up/down votes | CLI, skill | MIT, embed-OK. 13,984★. Last push 2026-05-31, looks stalled | 15k npm/mo | 3 |
| **ByteRover** | Coding-agent memory | Markdown "context tree" with branch, commit, merge | MCP, 22+ agents | **ELv2. Archived 2026-09-27.** 4,944★ | arXiv 2604.01599 | 3 |
| **Letta Context Repositories** | Git-backed agent memory | Memory files with frontmatter | Letta Code only | Apache-2.0. 25.4k★ | Launched 2026-02-12 | 3 |
| **Context7** (Upstash) | Library docs for agents | Docs indexed from repos | MCP, CLI | Client MIT; backend closed. 64.2k★ | **2.92M npm/mo** | 2 |
| **mainline** | Git-native decision memory | Intent and decisions stored in git | CLI, skills, hooks | Apache-2.0 CLI | Early | 2 |
| **OpenViking** (ByteDance) | Context database as a virtual filesystem (`viking://`) | Knowledge, memories, skills, with L0/L1/L2 summaries | ls, tree, grep | **AGPL-3.0.** 41.6k★ | Trending | 2 |
| **Vercel skills / skills.sh** | Skills installer and leaderboard | SKILL.md folders | `npx skills add` | MIT. 38.2k★ | **17.7M npm/mo** | 2 |
| **Agent Skills spec / AGENTS.md** | Open formats | SKILL.md, AGENTS.md | Files | Apache-2.0 / MIT | AGENTS.md joined the Linux Foundation's AAIF on 2025-12-09; 60k+ projects | 2 |
| **Credal** | Enterprise MCP and agent registry | MCP servers, agents; versions and audit | MCP | Closed | 1,000+ connectors | 2 |
| **Augment Context Engine** | Code retrieval | Semantic code index | MCP | Closed | Claims +71–80% on 900 PR tasks | 1 |
| **Unblocked** | Org context for coding | Graph over code, PRs, Slack, docs | MCP, CLI, API | Closed | $20M Series A | 1 |
| **Greptile** | Code review | Repo graph | GitHub app | Closed | $25M Series A; reported $50M Series B (unverified) | 1 |
| **Sourcegraph / Amp** | Code search plus agent | Code index | Agent, MCP | Closed | Amp spun out Dec 2025 | 1 |
| **DeepWiki** (Cognition) | Generated repo wikis | Wikis for 50k+ repos | MCP | Closed (clone deepwiki-open is MIT) | — | 1 |
| **Mintlify** | Agent-first docs | llms.txt, `/mcp`, ChromaFs | llms.txt, MCP | Closed | $45M Series B; about half of docs traffic is AI agents | 1 |
| **Mem0** | Memory API | Memories (vector + graph) | SDK, MCP | Apache-2.0. 68.5k★ | $24M | 1 |
| **Zep / Graphiti** | Temporal knowledge-graph memory | Episodes, entities, edges | API, MCP | Graphiti Apache-2.0. 32.6k★ | — | 1 |
| **Supermemory** | Memory API | Memories, documents | API, MCP | MIT. 31.5k★ | About $3M | 1 |
| **Cognee** | Knowledge-graph memory | Graph + vectors | SDK, MCP | Apache-2.0. 33.1k★ | $7.5M | 1 |
| **Basic Memory** | Local Markdown knowledge | Notes plus graph | MCP | **AGPL-3.0.** 4.5k★ | — | 2 |
| **Hyperspell** (YC F25) | Company brain | Context graph "surfaced as a filesystem" | API | Closed | — | 1 |
| **Airweave** | SaaS retrieval | Indexes over 50+ sources | API, MCP | MIT. **Archived 2026-08-29** | $6M | 1 |
| **Glean** | Enterprise search | Enterprise graph | App, API | Closed | About $300M ARR (May 2026) | 1 |
| **Dust** | Multiplayer agents | "Synthetic filesystem" over company data | Agents | Core repo returns 404 | $40M Series B | 1 |
| **Contextual AI** | Enterprise RAG | Documents | Platform | Closed | About $100M raised | 1 |
| **LlamaIndex** | Parsing and RAG | Documents | SDK | MIT. 52.8k★ | $19M | 1 |
| **2026 context-layer seed rounds** | Enterprise context | Definitions, knowledge graphs | APIs | Closed | Uvi $7.5M; Modus $10M; Tribal $10M; Qontext $2.7M; Ekai $1.7M | 1 |
| Small OSS | Context infrastructure | — | — | UltraContext (Apache, 439★), neuledge/context (Apache, 434★, "package manager for AI-ready docs"), OpenContext (MIT, 1.3k★) | — | 2 |

**Patterns in the landscape:**
- The money goes to enterprise retrieval.
- "Context as code" is open source and underfunded, yet the downloads are large. rulesync's 1.14M/mo is evidence of real demand for compiling rules into each tool's format.
- There is churn: Airweave and ByteRover are archived, and Manus is now part of Meta.
- **The open formats have settled** (AGENTS.md, Skills, MCP). Do not invent a new source format.

## 2. The trend: agents work best with files and bash
**Evidence, in date order**
- **Manus, Jul 2025**: "file system as the ultimate context". Compression must be restorable: keep the path even when you drop the contents.
- **Letta, Aug 2025**: a plain filesystem agent scored 74.0% on LoCoMo vs Mem0 graph at 68.5% (self-reported).
- **Anthropic Agent SDK, 2025-09-29**: "The folder and file structure of an agent becomes a form of context engineering." Start with agentic search: semantic search is faster but "less accurate, more difficult to maintain, and less transparent".
- **Agent Skills, Dec 2025**: progressive disclosure. About 30–50 tokens per skill load at startup.
- **Vercel d0, 2025-12-22, "We removed 80% of our agent's tools"** ([post](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools)). Seventeen tools became bash over YAML/MD/JSON:
  - success went from 4/5 to 5/5;
  - time from 274.8s to 77.4s;
  - tokens from 102k to 61k.

  The caveat: it only worked because the semantic layer was already well documented.
- **Vercel, 2026-01-09**: per-call cost went from about $1.00 to $0.25 with a filesystem plus bash. **just-bash** is Apache-2.0, 4.5k★, 9.25M npm/mo, with a pluggable `IFileSystem`.
- **Mintlify ChromaFs, 2026-03-24** ([post](https://www.mintlify.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant)): a virtual filesystem on just-bash over a Chroma index.
  - Boot time went from 46s (p90) to 100ms, and it serves 30k+ conversations a day.
  - **Access control by pruning the tree per user.** Read-only.
- **Dust**: agents started writing paths like `/notion/engineering/...` on their own, so Dust built a synthetic filesystem with ls, cat and grep.
- **Letta Context Repositories, 2026-02-12**: git-tracked memory files; the tree is always in the prompt; frontmatter per file; a worktree per subagent.
- **LangChain deepagents**: virtual filesystem with pluggable backends and permission rules (MIT, 31k★).
- **Turso AgentFS**: a copy-on-write SQLite overlay with an audit log (MIT, 3.5k★).
- **Sandboxes**: Cloudflare Sandboxes GA (Apr 2026), E2B, Daytona.
- **Papers**:
  - "Everything is Context: Agentic File System Abstraction" ([OpenReview](https://openreview.net/forum?id=9vptLwVQJt)).
  - "From Everything-is-a-File to Files-Are-All-You-Need" ([2601.11672](https://arxiv.org/abs/2601.11672)).

**What files give agents:**
- progressive disclosure;
- exact-match grep;
- cheap navigation;
- strong priors from training;
- contents a human can inspect and diff;
- no embedding pipeline to maintain.

**What files lack:**
- permissions (Mintlify had to prune the tree);
- semantics (Vercel's caveat);
- freshness ("context drift");
- provenance;
- visibility of effects and undo ([2604.13536](https://arxiv.org/abs/2604.13536));
- speed over many reads: Arize found a fake PostgresFS scored 93/100 vs 99/100 for a real SQL skill ([Arize](https://arize.com/blog/postgresfs-vs-sql-skills-ai-agent-filesystem/));
- merge and review. Freestyle argues git should own history, branches, review and permissions ([post](https://www.freestyle.sh/blog/engineering/agent-filesystems-git)).

**What this means for us:** keep the source of truth in git as files, deliver it to agents as real or virtual files, and carry semantics, provenance and freshness as frontmatter plus CI checks.

## 3. Name check: "ContextFS"
| Holder | What | Signal |
|---|---|---|
| **contextfs.ai**, GitHub org `contextfs`, PyPI `contextfs` (62 releases), npm `claude-plugin-contextfs` | MagnetonIO's "Universal AI memory layer", with paid plans at $9 and $29 per seat | **Direct collision in the same category** |
| thustorage/ContextFS ("AgentVFS") | Branchable FUSE filesystem for agents; Apache-2.0, 46★ | Same name, adjacent concept |
| `@context-fs/core`, `@context-fs/just-bash` | A just-bash filesystem adapter | Overlaps our likely stack |
| Several other small repos | Context filesystem and MCP projects | The name is becoming generic |
| Domains | .com parked/for sale; .ai is a live product; .io and .org "Coming Soon"; .dev NXDOMAIN | — |
| Registries | npm and crates.io `contextfs` unclaimed | — |
| Trademarks | Not checked | — |

**Risk: high.** "FS" also misdescribes the vision, which is a package manager and CI for context, not a filesystem.

**Alternatives.** Checked 2026-11-05 for an exact GitHub org, npm package and PyPI name. "NX" means DNS returned NXDOMAIN, a weak sign the domain is free.

| Name | Idea | GitHub org / npm / PyPI | Repos with the name | .dev / .com |
|---|---|---|---|---|
| **Contextfile** | Dockerfile for context | free / free / free | 5 | NX / NX |
| **ctxlock** | Lockfile for context | free | 2 | NX / NX |
| **ctxdeps** | Dependency graph | free | 0 | NX / NX |
| **Keelfile** | Stable base | free | 0 | NX / NX |
| **Canon** (`canonctx`) | Single source of truth | free | 0 | NX / NX |
| **ctxpm** | Package manager | free | 1 | NX / NX |
| **contextpm** | Package manager | free | 2 | NX / .com taken |
| **Primerfile** | Primer for agents | free | 1 | NX / NX |
| **Groundfile** | Grounding | free | 3 | NX / .com taken |
| **ctxtree** | Tree | free | 1 | NX / NX |

**Avoid:**
- ctxhub, ctxrepo, agentcontext, contextrepo, contextops: taken on GitHub (contextops is also Packmind's term).
- ctxkit, lorekit, agentlore, contextlock, ctxctl: taken on npm, PyPI and/or GitHub.

## 4. White space
**The six capabilities in the vision:**
- **C1** compile one source into every agent's format
- **C2** open, git-native, works with any agent
- **C3** dependency tracking
- **C4** evals when context changes
- **C5** routing trace feedback to owners
- **C6** distribution and governance across repos

| Player | C1 | C2 | C3 | C4 | C5 | C6 | What it is missing |
|---|---|---|---|---|---|---|---|
| Packmind | ✔ | Partial | Partial (which files are used in which repo at which version) | ✘ | Weak | ✔ | Evals, trace loop, OSS governance |
| rulesync / Ruler | ✔✔ | ✔ | ✘ | ✘ | ✘ | ✘ | Everything after compilation |
| Tessl | Partial | ✘ | Partial | ✔ (with/without task evals) | ✘ | Registry | Openness, AGENTS.md coverage, feedback loop |
| Atlan AI Registry | Partial (aireg sync) | ✔ (spec) | Planned | ✘ (in closed Trident) | ✘ (in closed Trident) | Spec | v0.1; skills and agents only |
| Context Hub | ✘ | ✔ | Partial | ✘ | ✔ annotate plus votes | ✘ | Private org context; stalled |
| Letta | ✘ | ✔ | ✘ | ✘ | Within one agent only | ✘ | Teams, other agents |
| mainline | ✘ | ✔ | ✘ | ✘ | Decisions written back to git | Hub | Compilation, evals |
| Credal | ✘ | ✘ | ✔ | ✘ | ✘ | ✔ | Closed |

**Nobody closes the whole loop openly on git:**
trace signal → issue for the owner (CODEOWNERS) → PR → evals with and without the change in CI → compile to every agent's format → PRs into dependent repos, recorded in a lockfile.

Each piece exists somewhere:
- compilation: rulesync, Ruler;
- adoption tracking: Packmind;
- evals: Tessl;
- feedback: Context Hub;
- git memory: Letta.

**Reuse, don't rebuild:**
1. **Source format.** AGENTS.md plus the Agent Skills spec as canonical, with owner, depends_on, verified_at and ttl in frontmatter metadata.
2. **Compiler.** Depend on **rulesync** (MIT) as a library or CLI and upstream any new targets. Ruler is the fallback.
3. **Installs.** Stay compatible with Vercel `skills`.
4. **Evals.** Reimplement Tessl's published with/without method, and reuse skill-creator's Apache-2.0 eval scripts. Check each skill's license: the docx, pdf, pptx and xlsx skills are source-available.
5. **Feedback.** Borrow Context Hub's annotate and feedback design (MIT). Capture traces via Claude Code hooks and Codex session logs.
6. **Non-coding agents.** just-bash `IFileSystem` with the ChromaFs pattern: read-only, tree pruned per user. AgentFS only if writes need an audit log.
7. **Packmind.** Interoperate with it (import and export its standards) rather than fork it.
8. **Forkable leftovers.** Airweave (MIT, archived) connectors.
9. **Interop-only, never vendor:**
   - OpenViking and Basic Memory (AGPL);
   - ByteRover (ELv2);
   - the Tessl CLI (proprietary);
   - Anthropic's document skills (source-available).

## 5. Where a solo builder can win
1. **"Context CI" GitHub Action.** On any PR touching CLAUDE.md, AGENTS.md, skills or rules, run evals with and without the change on 5–20 repo tasks and comment the gap on the PR.
2. **Context lockfile plus dependency graph**, so "this edit affects 14 repos and 3 agents" becomes a query.
3. **"Dependabot for context"**: when an upstream source changes, open compiled PRs in dependent repos, with eval results attached.
4. **Trace-to-owner loop**: hooks detect context misses, and each becomes an issue assigned through CODEOWNERS.
5. **Freshness and provenance linter**: `owner`, `source`, `verified_at`, `ttl`.
6. **Build on others' work**: contribute targets to rulesync, follow the AGENTS.md and Skills specs, interoperate with Packmind.
7. **Read-only virtual filesystem for non-coding agents**: the same repo served through just-bash with per-user pruning.
8. **Take in orphaned users**: an importer from ByteRover's context tree format. The format can be read even though the ELv2 code can't be reused.
