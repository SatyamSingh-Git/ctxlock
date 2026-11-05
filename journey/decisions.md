# Decisions

Every significant decision, why it was made, and whether it still stands. Reversals are kept rather than edited away, because the reversal is usually the more useful record.

## Direction

| # | Decision | Reasoning | Status |
|---|---|---|---|
| D1 | Research before asking product questions, in eight parallel tracks | The brief asked for deep research first, and "who is it for?" can't be answered well before you know what exists | Stands. It surfaced the open gap and the reuse inventory |
| D2 | Invent no new context file format | AGENTS.md, Agent Skills and MCP are governed by AAIF and read by about 80 agents | Stands |
| D3 | Reuse open-source code and published methods wherever they fit, license-checked, with credit | Satyam's instruction: "you can always use it anywhere and everywhere needed" | Stands. ctxlock depends on rulesync, agnix and promptfoo rather than rebuilding them |
| D4 | Build the layer above the formats: dependency graph, behavioral CI, load telemetry joined to sources, feedback loop | The research found all four missing in the open; only closed products have pieces | Stands |
| D5 | First user: developer teams running several coding agents | Satyam's call. The formats are open and the agents observable, so it is fast to prove | Stands |
| D6 | Open source, Apache-2.0 | Satyam's call (OSS). Apache-2.0 for its patent grant, and because it is compatible with every reuse pick | Stands |
| D7 | Name: ctxlock, replacing ContextFS | ContextFS collided with contextfs.ai, a paid AI-memory product. ctxlock was free on GitHub, npm, PyPI and crates.io, and unregistered on four domains | Stands. Trademarks not yet checked (open item before 1.0) |
| D8 | Phase order: behavioral CI → graph → loop → business context → open specs | Each phase is provable on its own; CI gives value on day one | Stands |

## Mechanism

| # | Decision | Reasoning | Status |
|---|---|---|---|
| D9 | Trust metadata lives in a `ctxlock.yaml` registry, not in frontmatter | AGENTS.md has no frontmatter, Codex would inject YAML as text against its 32 KiB cap, and HTML comments fail lint L1 | Stands |
| D10 | PR checks lead with probes, units loaded and cost; full statistical evals run on a schedule or label | The builder check showed a per-PR suite detects only swings of about 10 points or more, while real harms are 0.5–3 points | Stands |
| D11 | LLM-drafted probes are allowed, reviewed once and committed | Probes are tests, not context; the evidence against generated context is about context | Stands, untested |
| D12 | In phase 1, `ctxlock build` reports and fills missing targets, and never overwrites | Teams maintain their files by hand; overwriting them is a migration | Stands |
| D13 | Predict each agent's loading, then verify it. Claude Code via real hook events; Codex via its own ported open-source tests | No Codex access | Stands |
| D14 | Isolate eval runs with throwaway copies, run-scoped `--settings` hooks and observe-and-deny probes, instead of Docker | No Docker available, and this is cheaper and safer | Stands, unproven until spike S1 |
| D15 | Count the per-PR budget in runs and minutes, not dollars | Runs use a Claude Max subscription | Stands |
| D16 | agnix is an opt-in adapter; skill-spec checks (L0) are native | Discovery depends on L0, and agnix needs `npx`/network | Stands |
| D17 | No `tinyglobby` dependency | Git lists ignored `CLAUDE.local.md` files itself; non-git folders need only a small walker | Stands (Task 1) |
| D18 | L8 "excessive procedure" is `info`, not `should` | It is a heuristic until evals can validate it | Stands |

## Process

| # | Decision | Reasoning | Status |
|---|---|---|---|
| D19 | Native execution on `main`, with one fresh review per batch of tasks | Satyam's choice plus his CLAUDE.md: never create branches unasked; reviews in proportion to risk | Stands |
| D20 | Keep a journey and a guide from the start | Satyam's instruction, modelled on ElevenPowers | Stands |
