# 4. The plan, and the environment that reshaped it

The plan is in [docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md](../docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md).

## Two parts

**Part 1** is the static core: 14 test-first tasks covering:
- `ctxlock scan`, `lint`, `budget` and `diff`;
- per-agent load prediction;
- lint rules L0–L13;
- a GitHub Action;
- a dogfood pass on three public repos.

It needs no API keys and costs nothing to run.

**Part 2** is four spikes:
- **S1:** pick the eval runner.
- **S2:** test rulesync as the compile backend.
- **S3:** reproduce a published result.
- **S4:** check predictions against real load events.

The spikes decide the next plan, for behavioral evals.

**Checked before writing the plan:**
- agnix's JSON output format, read from its docs. That made an opt-in adapter cheap.
- The license and current version of every library.
- The sticky-comment Action.
- What was installed: Node 22.17 and Claude Code 2.1.292 were present; Docker and the Codex CLI were not.

## The environment, and what it changed

The first version of the plan assumed Docker, the Codex CLI, and API keys for both Claude and OpenAI. Then Satyam replied:

> i have only claude, and use can use claude cli instead of api. docker desktop i dont have

> i have claude max subscription

That removed three assumptions at once. Each was replaced with something that turned out at least as good:

| Assumed | Replaced with |
|---|---|
| Docker containers for isolation | **A throwaway copy of the repo per run, with hooks passed through `claude -p --settings`** (a flag confirmed in the installed CLI), so nothing is written into the repo being tested. For probes, a `PreToolUse` hook **records the command Claude intends to run and then denies it**. A probe like "add lodash" shows whether Claude would use `pnpm` or `npm`, without installing anything or touching the network. This is cheaper and safer than a container. |
| Running Codex to check Codex predictions | **Porting Codex's own open-source loader tests** (`codex-rs/core/src/agents_md_tests.rs`, Apache-2.0), e.g. `total_byte_limit_truncates_later_project_docs`. Our Codex resolver is checked against Codex's expected behaviour without a Codex account. |
| A dollar budget per PR | **A budget in runs and minutes**, because the runs use a subscription, not API billing |
| Reproducing Docker-based benchmarks | **Two lighter published effects** that need only Claude Code: ETH's "a tool named in AGENTS.md gets used", and Vercel's "an index beats a skill" |

## Start

> native and start. but first update the readme to to look professional current work.

**Native execution** means building every task in this session, with one fresh review per batch rather than per task. That follows Satyam's CLAUDE.md rule that reviews should be proportionate.

**The README was rewritten for the pre-alpha state.** It says plainly that nothing is installable yet and that the example output is planned, with a roadmap showing what is done and what is in progress.

Then, as the build began:

> And i want you to have 1 folder from very start the "journey" should hold each and everything. How we started what we did. what changed what worked what broke, what found what we learned etc
> And the guide

That instruction is why this folder and [the-guide/](../the-guide/) exist. Both are modelled on Satyam's ElevenPowers repository. From here on, each batch of work ends with a chapter in this folder, plus updates to [decisions.md](decisions.md) and [mistakes.md](mistakes.md). The guide grows a page each time a feature ships.

Next: 05 (the build, starting with Task 1), written when the first batch ends.
