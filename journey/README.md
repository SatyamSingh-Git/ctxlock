# The journey

How ctxlock got here: what was tried, what changed, what worked, what broke, and what was learned. Each chapter is written when a stretch of work ends, and nothing is revised in hindsight. [decisions.md](decisions.md) and [mistakes.md](mistakes.md) are kept current throughout.

**Latest:** [04 — the plan, and the environment that reshaped it](04-plan.md).
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
