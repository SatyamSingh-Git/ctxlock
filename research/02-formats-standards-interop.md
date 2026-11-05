# Agent context formats, standards and interoperability

*Researched 2026-11-05 from primary docs, specs, GitHub repos (via `gh api`) and the npm API. Unverified: Windsurf character limits; an "Open Context Protocol" proposal; full ClawHavoc numbers; total MCP Registry server count.*

## 1. Formats

### 1.1 Agent Skills (SKILL.md)
**Spec** ([agentskills.io/specification](https://agentskills.io/specification))
- A skill is a directory with `SKILL.md` and optional `scripts/`, `references/`, `assets/`.
- Required frontmatter: `name` (1–64 chars, `[a-z0-9-]`, must equal the parent directory name) and `description` (1–1024 chars).
- Optional frontmatter: `license`, `compatibility` (≤500 chars), `metadata` (string→string map), `allowed-tools` (experimental).
- **The spec has no version number of its own. Skills have no version field and no dependency field.**

**Loading.** Progressive disclosure in three stages: metadata (about 100 tokens) at startup, the body on activation (under 5,000 tokens, under 500 lines), and resources on demand.

**Client guide**
- Scan `.<client>/skills` and `.agents/skills`, at both project and user level.
- "Project-level skills override user-level skills."
- Use a trust gate for project skills.
- Protect skill content from compaction.

**Governance.** [GOVERNANCE.md](https://github.com/agentskills/agentskills/blob/main/GOVERNANCE.md) was adopted **2026-11-04**. Agent Skills is now a Series of LF Projects, under AAIF. Spec and code are Apache-2.0, docs CC-BY-4.0. Maintainers come from Anthropic and Microsoft, among others.

**How the main tools implement it**

| Tool | What it scans | Budget and limits | Precedence on collision | Notable differences |
|---|---|---|---|---|
| **Claude Code** | `.claude/skills` only. **Does not scan `.agents/skills`** ([#31005](https://github.com/anthropics/claude-code/issues/31005), 444 👍, still open) | Listing cuts description + `when_to_use` at 1,536 chars. After compaction, each skill is re-attached with 5k tokens, 25k total. | **enterprise > personal > project**, the opposite of agentskills.io | Extra frontmatter: `when_to_use`, `disable-model-invocation`, `user-invocable`, `context: fork`, `model`, `hooks`, `paths`, etc. Commands are merged into skills. |
| **Codex** | `.agents/skills` from cwd up to repo root, plus `~/.agents/skills` and `/etc/codex/skills` | **Catalog limited to 2% of context or 8,000 chars** | Same-name skills both appear | A sidecar `agents/openai.yaml` holds the implicit-invocation policy and MCP `dependencies.tools` |
| **Copilot / VS Code** | `.github/skills`, `.claude/skills`, `.agents/skills`, plus user-level equivalents | — | — | — |

**Other adopters.** Zed (Skills replaced Rules), Devin Desktop, Kiro, Gemini/Antigravity. The vercel-labs/skills table lists about 80 agents, with **at least 30 distinct skill directories**.

### 1.2 AGENTS.md
- **Format.** Plain Markdown with no schema, frontmatter or imports. The nearest file wins.
- **Adoption.** 60k+ projects. Given to AAIF on 2025-12-09.
- **Codex.**
  - Looks for `AGENTS.override.md`, then `AGENTS.md`, then fallback filenames.
  - Files are concatenated from repo root down to cwd.
  - **Total cap: 32 KiB** (`project_doc_max_bytes`).
- **Claude Code.**
  - Reads AGENTS.md natively **from v2.1.277, but only when no CLAUDE.md exists**.
  - Issue #6235 collected 5,191 👍 asking for it.
- **Most-requested open issues:**
  - #91: a global path (147 reactions).
  - #9: directory support (109).
  - #11: imports (73).
  - #179: a standard `.agents/rules/` format (36).
  - #10: frontmatter (21).

### 1.3 Per-tool instruction formats
| Tool | Files | Activation | Precedence and limits |
|---|---|---|---|
| Claude Code | Managed `CLAUDE.md`; `~/.claude/CLAUDE.md`; `./CLAUDE.md`; `CLAUDE.local.md`; `.claude/rules/**/*.md` (`paths:`); auto memory `MEMORY.md` | Ancestors at launch; subdirectories and `paths` load lazily | `@` imports up to 4 hops; aim for under 200 lines; MEMORY.md loads 200 lines or 25 KB |
| Gemini CLI / Antigravity | GEMINI.md (global, workspace, JIT); `context.fileName` can be AGENTS.md | All concatenated | `@` imports to depth 5. Gemini CLI was replaced by Antigravity CLI 2026-06-18 |
| Cursor | `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`); AGENTS.md | Always / intelligent / glob / manual | Team > Project > User; under 500 lines |
| Copilot | `.github/copilot-instructions.md`; `.github/instructions/**/*.instructions.md` (`applyTo`, `excludeAgent`); AGENTS.md; CLAUDE.md; GEMINI.md | Always + `applyTo` | **Personal > repo > org**, all sent together |
| Devin Desktop (formerly Windsurf) | `.devin/rules/*.md` (`trigger`, `globs`); AGENTS.md; legacy `.windsurf` | always_on / glob / model_decision / manual | — |
| Kiro | `.kiro/steering/*.md` (`inclusion`, `fileMatchPattern`); AGENTS.md always included | always / fileMatch / manual / auto | Workspace > global; team steering via MDM |
| Cline | `.clinerules/`; also reads `.cursorrules`, `.windsurfrules`, AGENTS.md | Always or `paths:` | Workspace wins |
| Zed | **Only the first match** among 9 filenames | Always | Project > personal |
| Junie | `.junie/AGENTS.md`, rules, playbook | Always | Deduplicates identical content |
| Amazon Q | `.amazonq/rules/*.md` | Always | — |

**The path-scoping key has a different name in almost every tool:** `paths`, `globs`, `applyTo`, `fileMatchPattern`, `trigger`.

### 1.4 Plugins, subagents and hooks
- **Claude Code plugins**
  - Manifest: `.claude-plugin/plugin.json` (only `name` is required).
  - Components: skills, commands, agents, hooks, `.mcp.json`, LSP, output styles, `bin/`, `settings.json`.
  - Components are namespaced, e.g. `plugin:skill`.
- **Claude Code marketplaces**
  - Catalog file: `marketplace.json`.
  - Sources: path, github, git-subdir, url, archive, npm.
  - **Dependencies:** npm-semver ranges resolved against `<plugin>--v<version>` git tags. When several plugins constrain the same dependency, the highest version satisfying all ranges wins.
- **`claude plugin eval`**
  - Each case runs 3x with and 3x without the plugin.
  - Its format is incompatible with skill-creator's `evals.json`.
- **Anthropic's marketplaces**
  - `claude-plugins-official` holds 315 plugins.
  - `anthropics/skills` has 187.6k★.
- **Subagents**
  - Files: `.claude/agents/*.md`.
  - Precedence: managed > CLI > project > user > plugin.
- **Codex plugins**
  - "Portable" root `plugin.json` + `mcp.json` + `skills/`; OpenAI-specific settings go under `extensions.com.openai`.
  - **Also reads `.claude-plugin/marketplace.json`** and sets `CLAUDE_PLUGIN_ROOT` for compatibility.
- **Copilot custom agents**
  - Files: `*.agent.md`, with a 30,000-char body limit.
  - Versioning is the git SHA of the file.
  - VS Code plugins accept the Agent Plugins, Copilot, Claude and OpenPlugin formats.
- **Cursor plugins**
  - Manifest: `.cursor-plugin/plugin.json`.
  - Also loads Agent Plugins, and listings are manually reviewed.
- **Agent Plugins 1.0.0** ([spec](https://github.com/agentplugins/agent-plugins-spec), 2026-07-19)
  - Vendor-neutral. **TSC members are from Amazon, Cursor, Microsoft, OpenAI and Vercel. Anthropic and Google are not on it.**
  - Closed `plugin.json` schema.
  - Fixed `skills/` (must follow agentskills.io) and `mcp.json`.
  - Client-specific material goes in reverse-domain directories or keys.
  - **Explicitly defers:** dependency resolution, provenance verification, plugin testing, enterprise controls, audit trails.
- **Hooks have no shared format.**

### 1.5 MCP
**Current spec: 2026-07-28**
- **Stateless core.** `initialize` and session IDs are removed. Metadata travels per request in `_meta`. Optional `server/discover`.
- **Multi Round-Trip Requests** replace server-initiated elicitation, sampling and roots.
- **Cacheable lists.** `ttlMs`/`cacheScope` plus deterministic ordering, which keeps prompt caches stable.
- **Extensions.** Tasks, MCP Apps, Enterprise Managed Authorization.
- **Governance.** Under AAIF.

**SEP-2640 Skills Extension** (Final, 2026-04-23)
- Each file of a skill is a resource at `skill://<path>/<file>`. Methods: `skills/list`, `skills/get`.
- The skill format is delegated to agentskills.io.
- Every file carries a `sha256:` digest. Approval is bound to content, so any digest change revokes it.
- **Digests are unsigned and "MUST NOT be treated as a security boundary."**
- No version semantics. No dependencies.

**MCP Apps** (`ui://` resources, v2.0.4). OpenAI's Apps SDK migrates onto it.

**Registry**
- A metaregistry: `server.json` points to npm, PyPI or OCI packages.
- The API has been frozen at v0.1 ("preview") since 2025-10-24.
- **Servers only, not skills or rules.**

**Tool search is client-side, not in the spec.**
- Claude Code defers MCP tools by default.
- Description limits: 4,096 chars for upfront tools, 16,384 for deferred.
- The per-tool hint is a vendor key, `_meta["anthropic/alwaysLoad"]`.

### 1.6 Adjacent protocols
- **A2A v1.0.1.** Agent Card at `/.well-known/agent-card.json`, with skills and JWS signatures.
- **llms.txt.** A Markdown link index; GitMCP exposes it over MCP.
- **ACP v1.15.1.** Editor↔agent transport.

### 1.7 Comparison
| Format | Governance | Loading | Scoping | Tools | Versioning | Dependencies |
|---|---|---|---|---|---|---|
| Agent Skills | LF / AAIF | Progressive disclosure | project, user, admin, plugin | about 80 clients | None (free-form metadata) | None ([#110](https://github.com/agentskills/agentskills/issues/110)) |
| AGENTS.md | AAIF | Always-on, nearest wins | Directory tree | Most | None | None |
| CLAUDE.md + rules | Anthropic | Launch plus lazy | managed, user, project, local | Claude Code (+ compatibility readers) | None | `@` imports |
| Cursor `.mdc` | Cursor | 4 modes | Team > Project > User | Cursor | None | `@file` |
| Copilot instructions | GitHub | Always + `applyTo` | Personal > repo > org | Copilot | Git SHA | None |
| Kiro steering | AWS | 4 modes | Workspace > global | Kiro | None | `#[[file:]]` |
| Claude plugin | Anthropic | Namespaced | Marketplace | Claude Code (+ Codex, VS Code readers) | version + tags | **Semver ranges** |
| Agent Plugins 1.0 | AWS, Cursor, MS, OpenAI, Vercel | Skills + MCP | Client-defined | Cursor, VS Code, Codex | Semver recommended | **Deferred** |
| MCP 2026-07-28 | AAIF | Tools, resources, prompts | Per server | Universal | Date-versioned | None |
| SEP-2640 | MCP WG | `skills/list` + lazy reads | Per server | — | SHA-256 per file | None |

## 2. Registries and distribution
| Registry / tool | Model | Versioning | Integrity | Adoption |
|---|---|---|---|---|
| **skills.sh + `npx skills`** | Git-native; installs into about 80 agent directories by symlink or copy | `owner/repo@tag-or-commit`; `skills check`; experimental `skills-lock.json` with `--frozen-lockfile` | "Security audits" (not described) | **17.7M npm/mo** |
| Anthropic marketplaces | Git catalogs | version + tags | Some plugins "Anthropic verified" | 315 plugins |
| ClawHub | Hosted (Convex) | Versions, tags, pinning | Moderation | 173k npm/mo |
| Tessl | SaaS registry; `tessl.json` | Semver `--bump`; `tessl outdated`/`update` | Snyk scores, evals | — |
| **Microsoft APM** ([repo](https://github.com/microsoft/apm)) | `apm.yml` manifest; any git host; **compiles to 9 harnesses** | **`apm.lock.yaml`** with `resolved_commit`, SHA-256 `content_hash` and per-file hashes; transitive resolution | Hidden-Unicode scan, `apm audit` drift detection, **CycloneDX/SPDX SBOM**, `apm-policy.yml` with tighten-only inheritance | v0.35.0 (2026-10-22), 4.2k★ |
| Context7 | Hosted docs index | Version-specific docs | Community-contributed | 2.92M/mo |
| MCP Registry | Servers only | `version`, `isLatest` | Namespace verification | v1.8.7 |

Snyk ToxicSkills found 13.4% of 3,984 skills with a critical issue. Daily ClawHub submissions grew from under 50 to over 500 in three weeks.

## 3. Cross-tool sync and portability tools
- **rulesync.** `.rulesync/` source of truth, generating to **about 60 tools × 9 feature types**: rules, ignore, MCP, commands, subagents, skills, hooks, permissions, checks. It also imports, and does one-shot `convert --from cursor --to copilot,claudecode`. 1.14M npm/mo.
- **ruler.** `.ruler/AGENTS.md` + `ruler.toml`, nested directories, about 30 agents, auto-managed `.gitignore`. 339k npm/mo.
- **Packmind.** Approval workflow, rendering to multiple agents, and adoption tracking.
- **APM `compile`**, and agentrc.
- **Shims.** A symlink `AGENTS.md → AGENT.md`, or a CLAUDE.md containing only `@AGENTS.md`.

**Problems users report**
1. **Duplication and shims.** CLAUDE.md files that just say "follow @AGENTS.md", plus symlinks so Claude Code can see `.agents/skills`.
2. **Silent suppression.** Adding `CLAUDE.local.md` stops AGENTS.md from loading. Zed uses only the first of 9 filenames.
3. **Inconsistent precedence.** On skill collisions, project wins (agentskills.io), personal wins (Claude Code), or both show (Codex). For org vs personal, Copilot puts personal highest and Cursor puts team highest.
4. **Contradictions.** Claude "may pick one arbitrarily".
5. **Budget divergence.** 32 KiB in Codex, a 1,536-char skill listing in Claude, 2% of context for the Codex catalog. **One source file truncates differently in each tool.**
6. **Drift.** APM ships drift detection because hand-edited generated files diverge from the source.

## 4. The "Iceberg moment"
**How Iceberg solved table-format fragmentation**
1. A versioned, engine-neutral **table spec**: snapshots and manifests layered over Parquet.
2. A **REST catalog spec** with multiple implementations, such as Polaris.
3. Many engines with identical read semantics.

**Mapping that onto agent context**
| Iceberg layer | Context equivalent | Status |
|---|---|---|
| File format (Parquet) | SKILL.md, AGENTS.md | **Largely solved** (AAIF, about 80 clients) |
| Table format (snapshot, manifest, schema evolution) | A versioned **context set**: which units, at which digest, with what scope and activation | **Fragmented.** Candidates: APM `apm.yml` + lock, Agent Plugins (dependencies deferred), Claude `plugin.json`, `tessl.json`, `skills-lock.json`. None is neutral and complete. |
| Catalog API | Discovery, resolution and commit for context packages | **Missing.** The MCP Registry covers servers only. [agentskills#255](https://github.com/agentskills/agentskills/issues/255) proposes a `.well-known` index (open). |
| Engine semantics | Discovery paths, precedence, budgets, activation vocabulary | **Divergent.** No conformance suite; skills-ref is "demonstration only". |

**Verdict on the keynote claim: mostly right.**
- A common *file* layer now exists, with neutral governance: AGENTS.md, Agent Skills and MCP are all under AAIF.
- Two partial common layers emerged in 2026:
  - **Agent Plugins 1.0**: packaging, without Anthropic or Google.
  - **APM**: manifest, lockfile and policy.
- Still missing:
  - the table-format plus catalog-spec pair;
  - a conformance suite;
  - **anything for evals and feedback**.

**Template to copy: Apache Ossie.** A JSON/YAML core spec, a Pydantic SDK, a `compliance/` grader, an extension-token registry, and reference converters.

No verified "Open Context Protocol" proposal was found.

## 5. Reusable building blocks
| Component | Repo | License | Maturity | Reuse |
|---|---|---|---|---|
| Agent Skills spec + skills-ref | [agentskills/agentskills](https://github.com/agentskills/agentskills) | Apache-2.0 | 27k★, no releases, demo-only | **Adopt the spec.** Port `parser.py`, `validator.py`, `prompt.py` (the `<available_skills>` XML). |
| `npx skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT | 38k★, v1.7.6, 17.7M/mo | **Agent path table for about 80 agents** (`docs/agents.md`), installer, `installSkills` API, `skills-lock.json` |
| rulesync | [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync) | MIT | 1.6k★, v43.6.2, 1.14M/mo | **Best multi-format compiler** (import and export, about 60 tools × 9 features) |
| ruler | [intellectronica/ruler](https://github.com/intellectronica/ruler) | MIT | 3k★, 339k/mo | Target adapters, nested loading, `.gitignore` automation |
| **APM** | [microsoft/apm](https://github.com/microsoft/apm) + apm-action | MIT | 4.2k★, v0.35.0, 82 releases | **Manifest and lockfile design**, transitive resolution, policy inheritance, drift audit, SBOM. **The strongest base for "context like code".** |
| agentrc | [microsoft/agentrc](https://github.com/microsoft/agentrc) | MIT | 1.1k★ | Instruction generation |
| Packmind | [PackmindHub/packmind](https://github.com/PackmindHub/packmind) | Apache-2.0 | 321★ | Approval and adoption-tracking patterns |
| Agent Plugins | [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec) | CC-BY spec, Apache-2.0 schemas | 1.4k★, 1.0.0 | **Adopt `plugin.json`/`mcp.json` schemas** |
| Claude plugins | [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Apache-2.0 | 46k★ | Compatibility target, test corpus |
| MCP SDKs | TS / Python / Go | MIT → Apache-2.0 | TS 267M dl/mo | Serve context over MCP (resources, prompts, SEP-2640 skills) |
| MCP Registry | [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) | Apache-2.0/MIT | 7.4k★ | **OpenAPI, `server.json` schema, namespace verification, subregistry ETL. Fork it for a context catalog.** |
| ext-skills | [modelcontextprotocol/ext-skills](https://github.com/modelcontextprotocol/ext-skills) | Apache-2.0 | 762★ | SEP-2640 spec and threat model |
| Loader references | [openai/codex](https://github.com/openai/codex), [gemini-cli](https://github.com/google-gemini/gemini-cli), [zed](https://github.com/zed-industries/zed) | Apache-2.0 | — | Exact discovery and import semantics, for conformance tests |
| ClawHub | [openclaw/clawhub](https://github.com/openclaw/clawhub) | MIT | 9.5k★ | Registry implementation (tied to Convex) |
| GitMCP | [idosal/git-mcp](https://github.com/idosal/git-mcp) | Apache-2.0 | 8.5k★, stale | Repo → MCP |
| Apache Ossie | [apache/ossie](https://github.com/apache/ossie) | Apache-2.0 | 2.6k★ | **Template**: spec + SDK + compliance grader + converters |
| Iceberg / Polaris | apache/iceberg, apache/polaris | Apache-2.0 | — | REST catalog OpenAPI and commit-protocol patterns |

Not reusable as code: Tessl, Smithery, the skills.sh backend, the Context7 index.

## Top 10 gaps
1. **A neutral context "table format"**: a manifest plus lockfile for units, digests, scope and activation. APM is closest.
2. **A catalog API for context packages**, the equivalent of Iceberg REST.
3. **One activation and scoping vocabulary** that compiles to `paths`, `globs`, `applyTo`, `fileMatchPattern` and `trigger`.
4. **A precedence and conflict spec, plus a linter.**
5. **Spec versions and a harness conformance suite.**
6. **Dependencies and semver for skills and rules**, including skill↔MCP-server pairing.
7. **Signed provenance**: Sigstore, SBOMs, verified publishers.
8. **A portable eval format and CI gate.** At least three incompatible formats exist today.
9. **A trace→context feedback schema**: finding → patch → eval → publish.
10. **Budget-aware compilation plus load telemetry**: fit each harness's limits, and report what each tool actually loaded.
