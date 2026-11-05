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
| D21 | A symlink makes the unit it points to visible at the symlink's path, for every kind of unit | The AGENTS.md FAQ recommends `ln -s AGENTS.md CLAUDE.md`; Claude Code then reads AGENTS.md through that link, and both agents share one file | Stands (Task 2) |
| D22 | Frontmatter is parsed only for rules and skills | No agent gives `AGENTS.md` or `CLAUDE.md` frontmatter any meaning, and a markdown file that opens with `---` would raise a false error | Stands (Task 2) |
| D23 | Claude Code's always-on and skill-listing totals are reported without a limit | Claude Code documents no total cap on always-on instructions. The skill listing does have one, 1% of the context window, but its unit (tokens or characters) is undocumented, and an invented number would raise false alarms | Stands, corrected after the batch-1 review: the first version said neither had a cap |
| D24 | Codex predictions are checked by Codex's own loader tests, ported with the upstream commit recorded | The concrete form of D13; the tests encode Codex's behaviour more precisely than its docs | Stands (Task 5) |
| D25 | Readers serve only the files they list; discovery follows in-repo symlinks itself | One place decides what a link may reach, so no lookup can read through a link out of the repository | Stands (batch-1 review) |
| D26 | Unit IDs are `<kind>/<path>`, not the design's `<kind>/<name>` | Names collide across directories: two skills called `review`, two rules called `style` | Stands for now; decide before lockfiles in phase 2 |
| D27 | Each hook, MCP server, command, approval or endpoint variable in an agent's config gets a fingerprint: a sha256 of its file, its identity and its value, not its position | `ctxlock diff` flags a PR that adds or changes one. Reordering a file should not trip it, and a hash keeps tokens in `env` out of PR comments | Stands (Task 7) |
| D28 | The L2 inventory follows each vendor's current source or docs, not the plan's list of keys | The plan's VS Code key, `chat.tools.autoApprove`, has been renamed, and current VS Code ignores it in a repo; the settings VS Code still honours there, and Codex's and Claude Code's code-running settings, were missing | Stands (Task 7); pinned to the commits and pages in the code comments |
| D29 | A gitignored file the agent still uses on this machine is read locally: `CLAUDE.local.md` and `.claude/settings.local.json` | Claude Code loads the first and runs the hooks in the second. CI never sees either, since it reads git refs | Stands (Task 7 extended D17's rule to settings) |

## Process

| # | Decision | Reasoning | Status |
|---|---|---|---|
| D19 | Native execution on `main`, with one fresh review per batch of tasks | Satyam's choice plus his CLAUDE.md: never create branches unasked; reviews in proportion to risk | Stands |
| D20 | Keep a journey and a guide from the start | Satyam's instruction, modelled on ElevenPowers | Stands |
