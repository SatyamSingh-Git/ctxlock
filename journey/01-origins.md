# 1. Origins

## The brief

The project began with [00-brief.md](00-brief.md): a short message and three screenshots from a summary of Prukalpa Sankar's keynote at Atlan's Context Conference. The ask was broad on purpose:

> i want you to do very very deep research on current world work. what has been done and i want to create something that superuseful for AI context. And is actually built on these three priciples.

The three principles were the keynote's:
1. Build context for agents, not humans.
2. Manage context like code.
3. Treat context as a compounding asset.

The brief set no product shape, no audience and no technology. It asked for research first and a plan second, and said time and tokens were not a constraint. The working folder was already named `ContextFS`. That name did not survive (chapter 3).

## Research before questions

The usual way to start a new project here is a conversation: a few questions to learn who it is for and what success looks like, before anything is built. That was deliberately postponed. The brief explicitly asked for deep research first, and you can't sensibly answer "who is this for?" before you know what already exists. So the decision was to research first and ask the questions at the end, once there was something concrete to react to.

One orienting search came first. It confirmed three things:
- The keynote was Sankar's opening talk at the Context Conference.
- The "53% vs 100%" figures came from a January 2026 Vercel blog post.
- The name "ContextFS" was already used by at least four projects.

## Eight tracks in parallel

The research was split into eight independent tracks. Each went to its own agent with a written brief and an instruction to cite sources:

| # | Track | Report |
|---|---|---|
| 1 | The keynote itself, plus enterprise "context layer" vendors (Atlan, Databricks, Snowflake, Microsoft, Palantir, Google, dbt) | [research/01](../research/01-keynote-and-enterprise-landscape.md) |
| 2 | Context file formats and standards (Agent Skills, AGENTS.md, CLAUDE.md, rules, MCP), registries, and the "Iceberg moment" gap | [research/02](../research/02-formats-standards-interop.md) |
| 3 | Hard evidence on which context shapes actually work, including the original sources of the keynote's numbers | [research/03](../research/03-evidence-what-context-works.md) |
| 4 | Treating context like code: versioning, evals, linting, dependency tracking | [research/04](../research/04-context-as-code.md) |
| 5 | Self-improving context, agent memory, trace tooling, and routing feedback to owners | [research/05](../research/05-compounding-feedback-loops.md) |
| 6 | The startup and open-source landscape, the "filesystem as agent interface" trend, and a name check | [research/06](../research/06-landscape-filesystem-naming.md) |
| 7 | Security and governance of shared context | [research/07](../research/07-security-governance.md) |
| 8 | How each coding agent actually loads context at runtime, and what usage data it exposes | [research/08](../research/08-agent-runtime-internals.md) |

## "Use it anywhere and everywhere"

While the tracks were running, Satyam added an instruction that shaped everything after it:

> rember we are not trying to invent things compltetly new if you find a good idea from someones, a good code from someones else. you can always use it anywhere and everywhere needed.

Seven of the eight agents were sent a follow-up: list the open-source code in your area that we could depend on, fork or copy, with its license checked. The eighth covered closed enterprise products. So every research report ends with a "reusable building blocks" table. That instruction is the reason ctxlock depends on rulesync, agnix and promptfoo rather than rebuilding them ([decisions D3](decisions.md)).

Next: [02 — the research](02-research.md).
