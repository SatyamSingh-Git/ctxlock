# Other agents' files

ctxlock models how Claude Code and Codex load context. It also finds the files nine more agents read, and runs its **safety checks** on them, so a pull request cannot slip hidden text or a new hook past the check through `.cursor/` or `.github/`. ctxlock does not predict what these agents load. That is the next step, one agent at a time.

> **Status:** implemented and tested. Every path below was checked against its vendor's docs or loader code on 2026-11-23. A path no source confirms is not listed. Check again if you rely on a specific one.

## What runs on them

| Check | On these files |
|---|---|
| [L0](rules.md) encoding and symlinks | yes |
| [L0](rules.md) frontmatter | skills only: other agents' rule formats are not strict YAML (Cursor documents `globs: *.ts`), so ctxlock does not judge them |
| [L1](rules.md) hidden Unicode and hidden HTML comments | yes |
| [L2](rules.md) risky instructions, and the inventory of hooks, MCP servers and setup steps that `diff` gates on | yes |
| [L10](rules.md) owners | yes |
| [L15](rules.md) references in `ctxlock.yaml` | yes, so you can give these files owners under `units:` |
| Everything else (budget, coverage, shadowing, duplicates, length, staleness) | no: those rules are tuned to the agents ctxlock models |

The predictions for Claude Code and Codex never include these files. If a file is reachable both at a Claude Code or Codex path and at another agent's path (through a symlink), it is the Claude Code or Codex unit, exactly as before, and its bytes are checked through that unit. Another agent's execution config is the exception: it is always a unit of its own, so a link to it from a Claude Code path cannot take it out of the gate.

## Execution config

Execution config is read one of two ways:

- **Read server by server:** files that hold only MCP servers, in a format the vendor documents. Each server is listed. Anything else in the file is one more item, so a key ctxlock does not know still counts as a change.
- **Opaque:** everything else. ctxlock does not read the format, so **any edit counts as an execution-affecting change**, reformatting included. This is deliberate. A half-understood format could hide a change, and an opaque one cannot. Binary files count too: a compiled hook or a `.wasm` plugin is fingerprinted like any other file. To accept these changes without failing, set `L2-exec-config-changed` to `should` in the base branch's `ctxlock.yaml`.

A config path that is a symlink to a file ctxlock cannot read, one that git ignores, such as `.cursor/hooks.json -> ../node_modules/x/hooks.json`, or one outside the repository, is an `L2-exec-config-unread` must, since the agent follows the link. This holds for Claude Code's and Codex's config too.

Paths in these agents' folders match in any case (`.Cursor/mcp.json`, `.CURSOR/rules/x.mdc`), since Windows and macOS read them that way. Root file names such as `GEMINI.md` and `AGENT.md` match exactly, so `docs/agent.md` is not taken for one.

## The files

| Agent (family) | Instructions and rules | Skills | Execution config | Sources |
|---|---|---|---|---|
| Copilot (`copilot`) | `.github/copilot-instructions.md`; `.github/instructions/**/*.instructions.md` | `.github/skills/<name>/` | Read server by server: `.vscode/mcp.json` (`servers`). Opaque: `.github/workflows/copilot-setup-steps.yml`, which runs before the cloud agent starts; `.github/hooks/*.json`; `.github/mcp.json`, in any folder; `.github/copilot/settings.json` and `settings.local.json` | [instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [hooks](https://docs.github.com/en/copilot/reference/hooks-configuration), [setup steps](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-environment), [VS Code MCP](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) |
| Cursor (`cursor`) | `.cursor/rules/**/*.mdc` (a `.md` file there is ignored by Cursor, and by ctxlock); legacy `.cursorrules` | `.cursor/skills/<name>/` | Read server by server: `.cursor/mcp.json`. Opaque: `.cursor/hooks.json` | [rules](https://cursor.com/docs/context/rules), [skills](https://cursor.com/docs/context/skills), [MCP](https://cursor.com/docs/context/mcp), [hooks](https://cursor.com/docs/agent/hooks), [.cursorrules](https://forum.cursor.com/t/project-rule-in-cursorrules-not-applied-in-agent-chat-works-in-cursor-rules/154309) |
| Gemini CLI (`gemini`) | `GEMINI.md`, in any folder | `.gemini/skills/<name>/` | Opaque: `.gemini/settings.json`, which holds MCP servers, hooks and tool commands | [memoryDiscovery.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/memoryDiscovery.ts), [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/) |
| Antigravity (`antigravity`) | `.agents/rules/*.md`, and the legacy `.agent/`, `_agents/` and `_agent/` folders | (`.agents/skills`, already modelled) | Opaque: `hooks.json` and `mcp_config.json` in those folders, and `plugin.json` (or `.antigravity-plugin/plugin.json` or `.gemini-plugin/plugin.json`), `hooks.json` and `mcp_config.json` in each `plugins/<name>/` | [discovery](https://antigravity.google/docs/customization-discovery), [hooks](https://antigravity.google/docs/hooks), [MCP](https://antigravity.google/docs/mcp), [plugins](https://antigravity.google/docs/plugins) |
| Devin and Windsurf (`devin`) | `.devin/global_rules.md`, `.devin/rules/*.md`; legacy `.windsurf/global_rules.md`, `.windsurf/rules/*.md`, `.windsurfrules` | `.devin/skills/<name>/`, `.windsurf/skills/<name>/` | Opaque: `.devin/hooks.v1.json`, `.devin/mcp_config.json`, and `.devin/config.json` and `config.local.json` in any folder | [customizations](https://docs.devin.ai/desktop/devin-local/customizations.md), [CLI rules](https://docs.devin.ai/cli/extensibility/rules.md), [CLI hooks](https://docs.devin.ai/cli/extensibility/hooks/overview.md), [CLI MCP](https://docs.devin.ai/cli/extensibility/mcp.md) |
| Kiro (`kiro`) | `.kiro/steering/**/*.md` | `.kiro/skills/<name>/` | Read server by server: `.kiro/settings/mcp.json`. Opaque: `.kiro/hooks/*.json`, and custom agents in `.kiro/agents/*.json` or `*.md`, which can carry MCP servers and hooks | [steering](https://kiro.dev/docs/steering/), [skills](https://kiro.dev/docs/skills/), [hooks](https://kiro.dev/docs/hooks/), [MCP](https://kiro.dev/docs/mcp/configuration/), [custom agents](https://kiro.dev/docs/custom-agents/configuration-reference/) |
| Cline (`cline`) | `.clinerules` as one file, or `.md`, `.markdown` and `.txt` files in `.clinerules/` and `.cline/rules/` | `.clinerules/skills/<name>/`, `.cline/skills/<name>/` | Opaque: every script in `.clinerules/hooks/` and `.cline/hooks/` (Cline runs each, named for its event), and `.cline/plugins/` | [rules](https://github.com/cline/cline/blob/main/docs/customization/cline-rules.mdx), [paths.ts](https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts) |
| OpenCode and Kilo (`opencode`) | `.kilocode/` and `.kilo/` `rules/` and per-mode `rules-<mode>/`, `.kilocoderules` and `.kilocoderules-<mode>`; OpenCode's agent, command and mode prompts in `.opencode/{agent,command,mode}(s)/` | `.opencode/skill(s)/<name>/`, `.kilo/skill(s)/<name>/` | Opaque: `opencode.json(c)` and `kilo.json(c)` in any folder; `.kilo/mcp.json` and `.kilocode/mcp.json`; and every file in the `plugin`, `plugins`, `tool` and `tools` folders of `.opencode/`, `.kilo/` and `.kilocode/`, which these agents import and run; `.opencode/package.json`, which drives a background `npm install` | [instructions](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config/plugin/instruction.ts), [skills](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/v1/content/skills.mdx), [Kilo rules](https://kilo.ai/docs/customize/custom-rules) |
| Junie (`junie`) | `.junie/guidelines.md`, `.junie/guidelines/**/*.md`, `.junie/rules/**/*.md`, `.junie/playbook.md` (the last two only when there is no `.junie/AGENTS.md`) | `.junie/skills/<name>/` | Read server by server: `.junie/mcp/mcp.json`. Opaque: `.junie/config.json` | [guidelines](https://junie.jetbrains.com/docs/guidelines-and-memory.html), [skills](https://junie.jetbrains.com/docs/agent-skills.html), [MCP](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html) |
| Shared names (`other`) | `AGENT.md` (Devin, Amp, Zed, which reads it before `AGENTS.md`); `AGENTS.local.md` (Devin) | | | [Amp](https://ampcode.com/docs/customize/agents-md), [Zed](https://github.com/zed-industries/zed/blob/main/crates/prompt_store/src/prompts.rs), [Devin](https://docs.devin.ai/desktop/devin-local/customizations.md) |

## Not covered yet

- **Files in your home folder**, such as `~/.cursor` or `~/.gemini`. ctxlock reads repositories.
- **`.windsurf/mcp_config.json`, `.windsurf/hooks.json` and `copilot-setup-steps.yaml`.** No current source says these are read.
- **Claude Code's `.claude/settings.json` hooks, which Copilot CLI, Cursor and Devin CLI also run.** ctxlock already checks that file for Claude Code, so a change there is caught. The report just names Claude Code.
- **Agents with no repository files of their own**, such as Aider, Goose and Warp, and Roo Code, which is archived.
