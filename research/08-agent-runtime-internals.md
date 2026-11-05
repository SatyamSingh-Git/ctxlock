# How each agent actually loads context at runtime

*Researched 2026-11-05 from about 60 primary docs and source pages. Anything not confirmed is marked **UNVERIFIED**.*

**Product changes in 2026 that affect our targets:**
- The Copilot "coding agent" is now the **cloud agent**.
- Windsurf is now **Devin Desktop**.
- **Gemini CLI was replaced by Antigravity CLI** (2026-06-18) for consumer tiers.
- **Roo Code is end-of-life** (archived 2026-05-15; the community fork is Zoo Code).
- Codex docs moved to learn.chatgpt.com.

## 1. Claude Code and the Claude Agent SDK
**Instruction files** ([memory](https://code.claude.com/docs/en/memory))
- **Locations:** managed (`/etc/claude-code/CLAUDE.md`, `C:\Program Files\ClaudeCode\CLAUDE.md`, or a `claudeMd` key in managed settings), `~/.claude/CLAUDE.md` and `~/.claude/rules/`, `./CLAUDE.md` or `./.claude/CLAUDE.md`, `./CLAUDE.local.md`.
- **Load order:**
  - Ancestor files load at launch, from the filesystem root down to cwd.
  - Subdirectory CLAUDE.md files load **lazily**, the first time a file there is read or edited.
  - `.claude/rules/**/*.md` with a `paths:` glob load lazily on matching file access.
- **Imports:** `@path` imports, 4 hops deep.
- **HTML comments are stripped before injection.**
- **Size limits:**
  - Files loaded at launch: up to 4 MiB (a larger file is skipped).
  - Lazily loaded files: capped at 40K characters on a 200K window, then a note tells Claude to read the rest.
- Delivered as a user message after the system prompt. The root CLAUDE.md is re-read after `/compact`.
- **AGENTS.md (v2.1.277+)** is read only when no CLAUDE.md, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists. The default mode is `claude-md-or-agents-md`; it can be switched to `claude-md-and-agents-md`.
- `claudeMdExcludes` skips files.

**Skills** ([skills](https://code.claude.com/docs/en/skills))
- **Locations:** managed, `~/.claude/skills`, `.claude/skills`, nested (lazy), `--add-dir`, plugins, synced from claude.ai.
- **Listing:**
  - Description plus `when_to_use` is truncated at 1,536 characters.
  - The listing budget is 1% of the context window. On overflow, descriptions of the least-invoked skills are dropped first.
  - `skillOverrides: "name-only"` lists a skill without its description. `disable-model-invocation` removes it from context entirely.
- **Invocation and lifetime:**
  - Invoked through the `Skill` tool. The body enters the conversation as one message and stays there.
  - After compaction, the first 5k tokens of each invoked skill are re-attached, within a 25k total.
  - Files are watched and reloaded live.
- **Agent SDK:** skills load through `settingSources`. The `skills` option is an allowlist. The `system/init` message lists skills.

**MCP** ([mcp](https://code.claude.com/docs/en/mcp))
- Scopes: local, project (`.mcp.json`), user, plugin, claude.ai connectors, managed.
- **Tool search is on by default.** `alwaysLoad: true` opts a server out.
- Description limits: 4,096 characters upfront, 16,384 deferred.
- Output: 25k-token cap with a warning at 10k. Text over 50k characters is saved to a file.
- Resources are referenced as `@server:protocol://path`. Prompts become commands.

**Auto memory**
- Lives at `~/.claude/projects/<project>/memory/MEMORY.md`, plus topic files.
- Per repository, **machine-local**.
- At session start only the first 200 lines or 25KB load.
- Each memory has a type: user, feedback, project, or reference.

**Hooks** ([hooks](https://code.claude.com/docs/en/hooks))
- About 33 events. `additionalContext` works on SessionStart, UserPromptSubmit, Pre/PostToolUse, SubagentStart and others.
- 10,000-character cap. Over the cap, output goes to a file and Claude gets a 2,000-character preview.
- **InstructionsLoaded hook**:
  - Payload: `file_path`, `memory_type` (User/Project/Local/Managed), `load_reason` (`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`), `globs`, `trigger_file_path`, `parent_file_path`.
  - Runs asynchronously.
  - **Does not fire for AGENTS.md that Claude reads natively.**

**Org distribution**
- Managed settings: from the console (polled hourly), MDM, or `managed-settings.d/*.json` drop-ins.
- Org skills: provisioned in the admin console.
- Plugins: `.claude-plugin/plugin.json` plus skills, agents, hooks and `.mcp.json`.
- **A CLAUDE.md at a plugin's root is NOT loaded.**

**Telemetry** ([monitoring](https://code.claude.com/docs/en/monitoring-usage))
- OTel events:
  - `claude_code.skill_activated`, with `skill.name` and `invocation_trigger` (user-slash / claude-proactive / nested). Custom skill names show as `custom_skill` unless `OTEL_LOG_TOOL_DETAILS=1`.
  - `plugin_loaded`, `at_mention` (mcp_resource), `compaction`.
- Cost and token metrics carry `skill.name`, `plugin.name`, `mcp_server.name` and `mcp_tool.name`.
- Traces (beta): interaction, llm_request, tool, hook.
- `OTEL_LOG_RAW_API_BODIES=file:<dir>` dumps full request bodies.
- **No OTel event records CLAUDE.md loads. Use InstructionsLoaded instead.**
- Transcripts: `~/.claude/projects/<project>/<session>.jsonl`.

## 2. OpenAI Codex
**AGENTS.md** ([source](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs))
- Global: `~/.codex/AGENTS.override.md`, otherwise `AGENTS.md`.
- Project: walks from the root down to cwd, at most one file per directory.
- Concatenated root-down, so files closer to cwd come later.
- **32 KiB combined budget.** The file that crosses it is truncated, with the log line "Loaded only N of M bytes".
- **Built once per session. Files below cwd are never loaded.** Untrusted projects get no project docs.

**Skills**
- Locations: `.agents/skills` (cwd up to repo root), `~/.agents/skills`, `/etc/codex/skills`, bundled.
- **Catalog gets 2% of the context window or 8,000 characters.** Descriptions are shortened first, then skills are omitted with a warning.
- Invoked explicitly with `$skill`, or implicitly when the description matches.
- The sidecar `agents/openai.yaml` holds the implicit-invocation policy and MCP dependencies.

**MCP**
- Configured in `config.toml` `[mcp_servers]`.
- **All MCP tools are deferred behind `tool_search`** (PR #29486, 2026-06-22).
- Resources go through resource tools. Prompts: UNVERIFIED.

**Memories**
- Opt-in, under `memories_v2/`, generated in the background.
- The docs call them "generated state"; don't edit them by hand.

**Hooks**
- Events: SessionStart, UserPromptSubmit, Pre/PostToolUse, Pre/PostCompact, Pre/PostModelRequest, Subagent*, Stop, SessionEnd.
- `additionalContext` is capped at about 2,500 tokens.
- Sets `CLAUDE_PLUGIN_ROOT` for compatibility.

**Org**
- `requirements.toml`, `managed_config.toml`, MDM.
- **No documented way to distribute AGENTS.md through policy.**

**Telemetry**
- `[otel]` exporter.
- Metrics: `skill.injected{skill,status}`, `thread.skills.truncated`, `turn.memory{has_citations}`, `hooks.run`, `mcp.call{tool}`.
- Rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`session_meta`, `turn_context`, `response_item`, `event_msg`).
- What context the cloud product reads: UNVERIFIED.

## 3. GitHub Copilot
**Instructions by surface**
| Surface | copilot-instructions.md | *.instructions.md (`applyTo`) | AGENTS.md / CLAUDE.md / GEMINI.md | Personal | Org |
|---|---|---|---|---|---|
| Cloud agent | Yes | Yes | Yes | No | Yes |
| VS Code chat | Yes | Yes | AGENTS.md only | No | No |
| CLI | Yes | Yes | Yes | Yes | Not listed |

- **CLI:**
  - Merges CLAUDE.md, GEMINI.md, AGENTS.md, `.github/instructions`, `.claude/rules`, **from the git root and cwd only**.
  - `@path` imports.
  - **`copilot instruction list`** prints the instruction sources it discovered.
- **Org instructions apply only on GitHub.com and in code review.**
- **VS Code** now runs Copilot, Local, Claude and Codex harnesses, and each reads its own native formats.

**Skills**
- CLI locations, first match wins: `.github/skills`, `.agents/skills`, `.claude/skills`, `~/.copilot/skills`, `~/.agents/skills`.
- Name ≤64 characters, description ≤1,024.

**MCP**
- `~/.copilot/mcp-config.json`, `.mcp.json`, `.github/mcp.json`.
- **The cloud agent and code review support tools only.** Code review requires `readOnlyHint`.

**Copilot Memory**
- Repository facts with citations, re-validated against the current branch; user preferences.
- 90-day expiry.
- Cannot be created or edited directly.

**Hooks**
- Run in the CLI and the cloud agent.
- Config sources: policy hooks, `.github/hooks/*.json`, and **`.claude/settings.json`**.
- `additionalContext` works on sessionStart, subagentStart, postToolUse (10 KB) and others.

**Telemetry**
- CLI OTel follows the GenAI semantic conventions: `invoke_agent`, `chat`, `execute_tool`.
- **`github.copilot.skill.invoked` carries `skill.path`.**
- Content capture fills `gen_ai.system_instructions`.
- VS Code: **no attribute identifies instruction files**.

## 4. Cursor
- **Rules:**
  - `.cursor/rules/*.mdc` only; plain `.md` files there are ignored. Frontmatter: description, globs, alwaysApply.
  - AGENTS.md, nested.
  - Team Rules from the dashboard, which can be enforced.
  - **Precedence Team > Project > User, and the earlier source wins.** Keep rules under 500 lines.
- **Skills:**
  - Locations: `.agents/skills`, `.cursor/skills`, `.claude/skills`, `.codex/skills`.
  - Name and description sit in the system prompt; the agent finds skill files with grep or semantic search.
- **MCP:**
  - `.cursor/mcp.json`; supports tools, prompts, resources, roots and elicitation.
  - **Tool descriptions are synced to files and read on demand, which cut tokens by 46.9% in an A/B test** ([blog](https://cursor.com/blog/dynamic-context-discovery)).
- **Hooks:** sessionStart, beforeSubmitPrompt, preToolUse, **beforeReadFile**, afterFileEdit, stop. **Cursor loads Claude Code hooks.**
- **Telemetry:** Enterprise only; metrics and logs (`cursor.skill.activated`). Rules are not covered.

## 5. Gemini CLI and Antigravity
- GEMINI.md: global, workspace and parents, plus just-in-time loading on tool access.
- `context.fileName` can be `["AGENTS.md","GEMINI.md"]`.
- `@file` imports to depth 5. Everything is concatenated and sent with every prompt.
- **Skills:** `.gemini/skills` or `.agents/skills`. **Activation goes through `activate_skill` and asks the user to confirm.**
- **Hooks:** BeforeAgent, BeforeModel, BeforeTool, PreCompress, and others.
- **Telemetry:** a config inventory event and `tool_call`. **No event records GEMINI.md or skill use.**
- **Antigravity** reads GEMINI.md and AGENTS.md, has `.agents/skills`, and MCP config in `.agents/mcp_config.json`.

## 6. Devin Desktop (formerly Windsurf)
- **Context files:**
  - AGENTS.md, `AGENTS.local.md`, AGENT.md (subdirectories load lazily).
  - `.devin/rules/*.md` with a `trigger` field.
  - Also reads CLAUDE.md, `.cursor/rules` and legacy `.windsurf`.
- **Skills:** `.devin/skills`, `.agents/skills`.
- **MCP:** `.devin/mcp_config.json`.
- **Hooks:** `.devin/hooks.v1.json`.
- **Legacy Cascade:** 12,000 characters per rule.
- **Devin cloud:** reads the first 16 KiB of each AGENTS.md.

## 7. Amazon Kiro
- **Steering:**
  - `.kiro/steering` with `inclusion` set to always, fileMatch, manual or auto.
  - **AGENTS.md is always included.**
  - `#[[file:]]` references; team steering through MDM.
- **Skills:** `.kiro/skills`.
- **Powers:** bundle skills and MCP, activated dynamically.
- **MCP:** prompts and resources via `#`; tool names ≤64 characters.
- **Hooks:** `.kiro/hooks/<id>.json`.
- **Telemetry:** none found.

## 8. Cline and Roo
- **Cline:**
  - Rules: `.clinerules/`, `paths`.
  - Skills: `.cline/skills` and `.claude/skills`. **A global skill beats a project skill.**
  - SDK hooks support `appendContext`.
- **Roo:** end-of-life.

## 9. Chat projects and enterprise agents
- **Claude.ai Projects:** project knowledge switches to RAG automatically near capacity.
- **ChatGPT Projects:** project instructions plus sources.
- **Copilot Studio:** the orchestrator chooses tools, topics and knowledge from their names and descriptions.
- **Glean agents:** `spec.yaml` + `instructions.md` (≤32K characters) + `skills/*/SKILL.md` (description ≤1,000) + `subagents/`.
- **Agentforce:** UNVERIFIED.

## Cross-agent matrix
| Capability | Claude Code | Codex | Copilot | Cursor | Gemini/Antigravity | Devin | Kiro | Cline |
|---|---|---|---|---|---|---|---|---|
| Native file | CLAUDE.md, .claude/rules | AGENTS.md | copilot-instructions, *.instructions.md | .cursor/rules/*.mdc | GEMINI.md | AGENTS.md, .devin/rules | .kiro/steering | .clinerules |
| Reads AGENTS.md | Only if no CLAUDE.md | Yes | Yes | Yes | Configurable / yes | Yes | Always | Yes |
| Subdirectory loading | Lazy on access | Root→cwd at start | Git root + cwd | Nested | JIT | Lazy | Yes | ? |
| Glob rules | `paths` | **No** | `applyTo` | `globs` | No | `trigger: glob` | `fileMatch` | `paths` |
| Imports | @, 4 hops | No | CLI @ | ? | @, 5 deep | ? | #[[file:]] | ? |
| Size cap | 4 MiB at launch / 40K lazy | **32 KiB total** | ? | 500 lines (guidance) | ? | 12K/file; **16 KiB cloud** | ? | ? |
| Skills | Yes | Yes | Yes | Yes | Yes (consent) | Yes | Yes | Yes |
| Skill list budget | **1%; 1,536 chars/entry** | **2% or 8K chars** | ? | ? | ? | ? | ? | ~100 tok/skill |
| MCP deferral | Tool search, default | tool_search, default | ? | Files on demand | ? | ? | Powers | ? |
| Auto memory | MEMORY.md (local) | memories_v2 (opt-in) | Copilot Memory | ? | ? | Workspace memories | ? | ? |
| Hook context injection | Yes (10K chars) | Yes (~2.5K tokens) | Yes | Yes | Yes | ? | Agent Spawn | SDK |
| Reads Claude hooks | — | Partial | **Yes** | **Yes** | No | ? | No | No |
| Skill-use signal | `skill_activated` | `skill.injected` | `skill.invoked` (+path) | `skill.activated` | No | ? | ? | ? |
| Instruction-load signal | **InstructionsLoaded hook** | Rollout text | `copilot instruction list` | No | `/memory show` | Customize page | No | No |

## Compiler targets
**What to emit from one source of truth**
1. **AGENTS.md, root and nested.** The widest-reach artifact.
   - For Claude: either emit no CLAUDE.md, or a CLAUDE.md containing `@AGENTS.md` plus the Claude-only extras.
   - For Gemini: set `context.fileName` to include AGENTS.md.
   - **Keep the root→leaf chain ≤32 KiB (Codex) and each file ≤16 KiB (Devin cloud).**
2. **One canonical SKILL.md per skill**, mirrored or symlinked to `.agents/skills`, `.claude/skills`, `.github/skills`, `.kiro/skills` and `.cline/skills`.
   - Lowest common constraints: name ≤64 characters, lowercase-hyphen, matching the directory; **description ≤1,000 characters**.
   - **Front-load trigger words**, because budgets truncate descriptions.
3. **Path-scoped rules**, compiled per target:
   - Claude: `paths:`
   - Copilot: `applyTo`
   - Cursor: `globs`
   - Devin: `trigger: glob`
   - Kiro: `fileMatch`
   - Cline: `paths`
   - **Codex has no glob rules.** Fall back to a nested AGENTS.md (applies only when cwd is at or below that directory) or a skill.
4. **Description-triggered guidance:** Cursor Apply Intelligently, Devin `model_decision`, Kiro `auto`. Elsewhere, compile it as a skill.
5. **MCP config** per target: `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, Gemini settings, `.agents/mcp_config.json`, `.devin/mcp_config.json`. The Copilot cloud agent is configured in repository settings, not a file.
6. **Hooks.** `.claude/settings.json` reaches Claude, Copilot and Cursor. Also emit Codex, Copilot, Cursor, Gemini, Kiro and Devin hook files.
7. **Org layer.** Each tool has its own console (Claude managed `claudeMd` and org skills; Codex `/etc/codex/skills`; Copilot org instructions; Cursor Team Rules; Kiro MDM; Devin system rules). These are proprietary.

**What cannot be expressed portably**
- **Lazy-loading triggers.** Claude loads on file access; Codex only along root→cwd at start; Gemini just-in-time; Copilot from the git root and cwd only.
- **Precedence.** Cursor's earlier source wins; Claude and Codex let the later, closer file win; in Cline a global skill beats a project skill.
- **Size budgets and truncation.** They differ per agent.
- **Imports.** Must be inlined for Codex and Cursor.
- **Skill frontmatter extras.** `context: fork`, `hooks`, `allowed-tools`, `agents/openai.yaml`.
- **Hook output caps.** 10K characters (Claude), about 2.5K tokens (Codex), 10 KB (Copilot).
- **Consent before activation** (Gemini).
- **MCP resources and prompts** in the Copilot cloud agent.
- **Memory is not a compile target.** Treat it as feedback you read back.
- **Plugins can't carry always-on context into Claude Code.** Use a skill or a SessionStart hook instead.

**Existing compilers to reuse or wrap**
- **rulesync** (MIT, about 70 targets, pushed today): the best base to wrap.
- **ruler** (MIT, about 30 agents): mature, but weaker on scoping.
- **vercel-labs/skills** (MIT, 79 agents): skills only; telemetry on by default.
- **skillkit** (Apache-2.0, 46 agents).
- **openskills** (Apache-2.0, stale).
- **block/ai-rules** (Apache-2.0, 11 agents).
- **dotagents** (MIT, symlinks).
- Built-in importers: Claude `/import`, Codex external-config import, `agy plugin import gemini`.

## Observability: learning which context was used
**Approach:** resolve statically what each target should load for a given cwd, then confirm with runtime evidence.

| Agent | Runtime evidence available |
|---|---|
| **Claude Code** | <ul><li>**InstructionsLoaded hook**: file, scope, load reason, trigger file, parent import. An exact dependency edge.</li><li>OTel `skill_activated` (needs `OTEL_LOG_TOOL_DETAILS=1`).</li><li>`skill.name` and `mcp_tool.name` on cost metrics.</li><li>Raw API bodies, transcript JSONL.</li><li>**Caveat: HTML comments are stripped, so a provenance marker must be visible text, or rely on `file_path`.**</li></ul> |
| **Codex** | <ul><li>`skill.injected{skill}`, `thread.skills.truncated`, `turn.memory{has_citations}`, `mcp.call`.</li><li>Rollout JSONL holds the injected text.</li></ul> |
| **Copilot** | <ul><li>`copilot instruction list`.</li><li>`github.copilot.skill.invoked` with `skill.path`.</li><li>`gen_ai.system_instructions` (with content capture).</li></ul> |
| **Cursor** | <ul><li>`cursor.skill.activated`.</li><li>A `beforeReadFile` hook to infer which path-scoped rules fired.</li></ul> |
| **Gemini** | Config inventory, `/memory show` |
| **Devin** | The Customize page |
| **Kiro, Cline** | Nothing documented |

**Open-source parsers to reuse**
| Project | License | Covers | Notes |
|---|---|---|---|
| **ccusage** | MIT, 19k★ | Cost for Claude, Codex, Copilot, Gemini | Not context-aware |
| **agentsview** | MIT, 6.4k★ | Sessions from 50+ agents into SQLite/DuckDB | Active |
| cass | "MIT + rider" | 30+ providers | **Needs legal review** |
| claude-code-log | MIT | Claude transcripts | — |
| claude-code-transcripts (simonw) | Apache-2.0 | Claude transcripts | — |
| openinference | Apache-2.0 | `instrumentation-claude-agent-sdk` | — |
| claude-code-otel | MIT | Claude Code OTel stack | Stale |
| copilot-opentelemetry | MIT | VS Code Copilot traces | Tiny |

**None of these extracts "which context file or skill was used".** That join (InstructionsLoaded, skill events and rollout text, matched to source IDs) is a gap we would fill.
