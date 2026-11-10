# The journey

How ctxlock got here: what was tried, what changed, what worked, what broke, and what was learned. Each chapter is written when a stretch of work ends, and nothing is revised in hindsight. [decisions.md](decisions.md) and [mistakes.md](mistakes.md) are kept current throughout.

**Latest:** [13 — propagation: one skill, many repositories, pinned](13-propagation.md).
- Plan 6: `upstream:` in `ctxlock.yaml`, `ctxlock sync` and `ctxlock.lock`, `L16-lock`, tiers from the lock, `impact --locks` across repositories, `ctxlock report`, and a workflow template; 582 tests.
- Live on an org repository and two consumers, a rule edited upstream named only the consumer that takes it, and a hand edit was refused by sync and flagged by `L16`.
- Found: the final review broke sync's central promise twice, through a link and a file name in the upstream; Windows 8.3 names broke CI again, in new code; and the live demo caught a lock that moved on every org commit.

**Earlier:** [12 — the collector: what Claude Code actually loaded](12-collector.md).
- Plan 5: a Claude Code plugin that records which units developers' sessions load, as paths and digests only; `ctxlock loads`; observed sessions in `who-uses`; 522 tests.
- Live on S4's fixture, the loads ctxlock reported matched Claude Code's own load events exactly.
- Found: eval's digest misread CRLF checkouts; Claude Code dropped every load event in one session of six; and the final review caught "not loaded" judging every session from the repository's top.

**Earlier:** [11 — the graph: what a change reaches, and who should look](11-graph.md).
- Plan 4: `depends-on` and consumers in `ctxlock.yaml`, `ctxlock who-uses`, `ctxlock impact` and an Impact section in the pull request comment, `L15-graph`, and `eval` running the probes of everything a change reaches; 486 tests.
- On openai-agents-python, four declared references between its skills were enough to name four dependent skills, a consumer and the owners to ask for a one-line edit.
- Found: CI on `main` red for three pushes over Windows 8.3 short names, and a plan that let a pull request hide its own reach by deleting an edge.

**Earlier:** [10 — build: closing the gaps between agents, without touching what people wrote](10-build.md).
- Plan 3: `ctxlock build` reports each agent's budget, the gaps between Claude Code and Codex, and drift; `--fill-missing` writes skill copies, `CLAUDE.md` imports and `AGENTS.md` files, and records them; `L14-generated` catches drift in what it wrote; 434 tests.
- On three public repositories and the S2 fixture, every gap ctxlock could close it closed, and lint agreed.
- Found live: plano gitignores `.agents`, and the first fill wrote skill copies there that could never be committed.

**Earlier:** [09 — behavioral CI: the agent runs, nothing it tries does](09-behavioral-ci.md).
- Plan 2: `ctxlock eval`, `ctxlock probe draft`, and a behavioral section in the Action, built test-first against a stand-in for Claude Code; 354 tests.
- Checked live in 73 runs: isolation held against a fixture built to break it, and every planted change to an instruction or a skill description on three public repositories was caught and cleared by its revert.
- Found live: a drafting prompt too long for a Windows command line, and that real context files mostly repeat the repository (1 of 9 drafted probes kept).

**Earlier:** [08 — the spikes: watching the agent without letting it act](08-spikes.md).
- Spikes S1, S3 and S4, on 99 headless Claude Code runs. Nothing the agent tried ran, and the weekly usage window moved two points.
- A tool named in `AGENTS.md` was used 15 of 15 times, unnamed 0 of 12; an index did not beat a skill in a small repository, but the skill took twice the turns.
- Every load Claude Code reported matched ctxlock's prediction, except one it never reports: an `AGENTS.md` read through its fallback.

**Earlier:** [07 — the Action, four real repositories, and a third way past the comment rule](07-action-and-dogfood.md).
- Tasks 13–14: the GitHub Action, and ctxlock run on four public repositories. No `must` findings, 18 real stale paths in sentry, and 33 false positives fixed by rule.
- A fresh review of Tasks 11–14 found that inline code was still a regex and could hide a comment, that edits to known hidden comments went unnoticed, that skill hooks were missed, and that the comment could carry injected markdown. All fixed test-first.
- Spike S2: rulesync works as a library, but ctxlock has to decide what goes where.
- Spike S1 started: observe-and-deny works, and run copies must stay out of the home folder.

**Earlier:** [06 — the second batch: the rules, the commands, and a review that broke two of them](06-second-batch.md).
- Tasks 6–12: all lint rules (L0–L11, L13), `ctxlock scan`, `lint`, `budget` and `diff`, runnable from source.
- Vendor source, not the plan, decided what the config inventory covers; VS Code had renamed the plan's key.
- `diff` judges a pull request with the base branch's settings, so it cannot switch off its own checks.
- A fresh review found two ways to hide a comment past a hand-written markdown scanner, and the false positives that would make a team switch the tool off. Fixed test-first with a real CommonMark parser; 238 tests.

**Earlier:** [05 — the first batch: reading repos and predicting what agents load](05-first-batch.md).
- Tasks 1–5: the repository readers, unit discovery, `ctxlock.yaml` and CODEOWNERS, and predictions for Claude Code and Codex.
- Codex is checked against Codex's own ported loader tests.
- The first worked example found a silent loss: a sub-team's `AGENTS.md` that Claude Code never loads and Codex cuts short.
- A fresh review found the reader could follow a symlink out of the repo, and that the Claude Code prediction had drifted from the docs. Both were fixed test-first; 89 tests.

**Earlier:** [04 — the plan, and the environment that reshaped it](04-plan.md).
- The plan has two parts: the static core, and four spikes.
- The first version assumed Docker, Codex and API keys; none was available.
- Each was replaced:
  - Docker → throwaway copies with run-scoped hooks;
  - running Codex → Codex's own open-source loader tests;
  - dollar budgets → run budgets.
- The probe design that came out of this is safer than containers: it records what the agent *intends* to run, then blocks it.

**Earlier:** [03 — the design](03-design.md).
- "dbt + Dependabot + Sentry for agent context".
- A fresh reviewer found the per-PR eval suite could only see 10-point swings while the real harms are 2-point ones; probes replaced it.
- Satyam chose open source, multi-agent dev teams, and the name ctxlock (checked free).

**Earlier:** [02 — the research](02-research.md).
- About 400 sources.
- The formats and plumbing already exist; the dependency graph, behavioral CI and feedback loop do not.
- Several keynote numbers were mislabelled.
- Context often makes agents *worse*.

**Earlier:** [01 — origins](01-origins.md).
- The keynote, the brief, research before questions.
- Eight parallel tracks.
- "Use it anywhere and everywhere."

**Start:** [00 — the brief](00-brief.md), verbatim.

---

| File | What it holds |
|---|---|
| [00-brief.md](00-brief.md) | The original ask and the keynote screenshots, transcribed unedited |
| `NN-*.md` | Chapters, in order |
| [decisions.md](decisions.md) | Every significant decision, its reasoning, and whether it still stands |
| [mistakes.md](mistakes.md) | What went wrong, why, what it cost, and what changed |

The research itself is in [research/](../research/). The design and plan are in [docs/superpowers/](../docs/superpowers/).
