# 8. The spikes: watching the agent without letting it act

Spikes S1, S3 and S4 of [the plan](../docs/superpowers/plans/2026-11-05-ctxlock-static-core-and-spikes.md), run straight after chapter 7 in the same session. Chapter 7 covered S2 (rulesync) and the first smoke run of S1. All four spikes are now done. Their memos are what Plan 2, behavioral Context CI, will be written from.

Every run used Claude Code 2.1.292 headless on Satyam's Max subscription, on Sonnet 5.5, to spare the usage window. The plan allowed 150 runs for S1 and S3; they used 96, and S4 three more. The weekly window read 55% before the first run and 57% after the last, and that includes this session's own work.

## What exists now

| Spike | Result | Memo |
|---|---|---|
| S1: the eval runner | A harness of about 110 lines records what loaded and what the agent tried, and lets nothing run: 21 of 21 calls denied, 21 of 21 fixtures unchanged. promptfoo can wrap it, but ctxlock will use its own (D35) | [S1](../docs/spikes/S1-eval-runner.md) |
| S3: two published effects | **Adherence reproduces:** a tool named in `AGENTS.md` was used 15 of 15 times, unnamed 0 of 12. **Index versus skill does not, in correctness:** every arm was right 15 of 15 times. The skill route took twice the turns | [S3](../docs/spikes/S3-reproduction.md) |
| S4: the telemetry join | Every load Claude Code reported was joined to a ctxlock unit by path and content, and all 8 predictions matched. The observed session is now a test | [S4](../docs/spikes/S4-telemetry.md) |

The suite has 266 tests.

## What worked

**Letting the runs find the problems.** Three leaks would each have spoiled every probe, and none was in the plan:
- **A personal file.** A copy in the system temp folder sits under the home folder, so Claude Code walked up and loaded `~/.claude/CLAUDE.md` as a parent project's file: about 28,000 tokens of Satyam's own instructions in each run.
- **Outside tools.** The default tool set includes tools that publish or schedule things outside the run.
- **PowerShell.** On Windows the agent can reach for `PowerShell` instead of `Bash`, and one S3 run did.

The first smoke run, a second one, and the S3 runs found these in turn. Each fix is a line in the harness and a row in the S1 memo.

**Reading the agent itself.** Two questions were settled by reading the Claude Code binary, not by guessing:
- Where the setting that changes how `AGENTS.md` loads lives: in each developer's own settings, which a repository can't see.
- Why the `AGENTS.md` fallback leaves no trace: the plugin reports its loads only to its own analytics event.

**Pinning the observed behaviour.** S4 found nothing to fix, so its session became a conformance test, the way Task 5 ported Codex's own loader tests. If ctxlock's Claude Code prediction drifts from what the agent was seen to do, the build fails. 4 of 4 mutations of the resolver were caught.

## What broke, or didn't reproduce

- **promptfoo would not start.** Its current releases need Node 22.22, and this machine has 22.17. Rather than change the system unasked, the spike used an older release. Its SQLite database then needed a native build, and a JavaScript assertion read a field that version does not pass. Each is in the S1 memo, and together they are why D35 went the way it did.
- **The Vercel effect did not reproduce.** In a repository of five short docs, the agent found every answer with one search, with or without a pointer. That is a finding about the probe, not about Vercel: retrieval probes need something to make retrieval hard.
- **Numbers written before they were counted, three more times.** A test count, a package count and a prediction count. The check recorded in [mistakes.md](mistakes.md) after chapter 7 caught all three before their commits.

## What was learned

- **An adherence probe is only as good as the tool it names.** ruff showed no effect because the model already uses it. A probe that names the model's default measures nothing, and reads as "this context does nothing" (D36).
- **The cheapest isolation is the right default.** Setting sources, a tool allowlist, a copy outside the home folder, and a hook that denies. No Docker was needed, and nothing ran.
- **What the agent reports is not everything it reads.** `AGENTS.md` read through Claude Code's fallback leaves no trace in hooks or output, even though the agent followed it in every run. A collector that trusts the hooks alone would report those repositories as having no context (D37).
- **Strong effects are cheap to see.** A one-line change flipped the intended command in every run, so three runs per arm are enough for effects that size. The hard part of behavioral CI is designing probes that can tell, not running enough of them.
