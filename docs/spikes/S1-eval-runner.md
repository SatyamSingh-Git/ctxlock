# Spike S1: the eval runner

**Date:** 2026-11-06 · **Claude Code:** 2.1.292, headless (`claude -p`) on a Claude Max subscription · **Runs used:** 21 of the 150 allowed for S1 and S3 · **Code:** [`spikes/runner/`](../../spikes/runner/)

**Question:** can ctxlock run Claude Code headless on a throwaway copy of a repository, see what it loaded and what it tried to do, and make sure nothing it tries actually runs? And should that runner be ctxlock's own or a promptfoo provider?

**Answer: yes, and ctxlock's own.** A thin harness of about 110 lines, with no dependencies, does all of it:
- **Observe-and-deny worked on every run:** 21 of 21 denied, 21 of 21 fixtures unchanged, no errors.
- **Each arm did what its context said, every time.** The two probes separated the arms perfectly: 12 of 12 runs ran the command their arm's context implies.

promptfoo can drive the same harness as a custom provider, and that works too. It adds about 850 packages and a native database, and recent releases need a newer Node than ctxlock supports. It does none of the work that matters here, which happens in the harness either way.

## How a run works

[`run.mjs`](../../spikes/runner/run.mjs) does five things:
1. It copies the fixture arm into a fresh folder and runs `git init` in it.
2. It writes a run-scoped settings file outside the copy, so the agent never sees it.
3. It runs:
   ```sh
   claude -p "<prompt>" \
     --output-format stream-json --verbose \
     --settings <run>/settings.json \
     --setting-sources project \
     --strict-mcp-config \
     --tools Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill \
     --no-session-persistence \
     --model sonnet
   ```
4. It keeps the stream.
5. It hashes every file before and after the run.

The settings file has three hooks. Each calls [`hook.mjs`](../../spikes/runner/hook.mjs), which appends the event to a JSONL log:

```json
{
  "hooks": {
    "InstructionsLoaded": [{ "hooks": [{ "type": "command", "command": "node \".../hook.mjs\" InstructionsLoaded \".../events.jsonl\"" }] }],
    "PostToolUse": [{ "matcher": "Skill", "hooks": [{ "type": "command", "command": "node \".../hook.mjs\" PostToolUse \".../events.jsonl\"" }] }],
    "PreToolUse": [{ "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node \".../hook.mjs\" PreToolUse \".../events.jsonl\"" }] }]
  }
}
```

For `PreToolUse`, the hook also prints a `deny` decision:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "observe-and-deny: ..." } }
```

### Isolation: three things that leaked, and what stops each

| Leak | Seen as | Fix |
|---|---|---|
| The user's plugins, skills, hooks and MCP servers | Claude Code reads user settings by default | `--setting-sources project` and `--strict-mcp-config`. The first run's init message listed only built-in skills, and no MCP servers |
| **The user's own `~/.claude/CLAUDE.md`** | With copies in the system temp folder, which is under the home folder, Claude Code walked up from the copy and loaded `~/.claude/CLAUDE.md` as a parent project's file (`memory_type: "Project"`). Every probe carried about 28,000 tokens of personal instructions: the cached prompt fell from 35,174 to 6,942 tokens once it was gone | Run copies live in the repository's gitignored `.superpowers/s1-runs/`, with no `CLAUDE.md` above it. In CI, use a folder outside `$HOME` |
| Tools that act outside the run | The default tool set includes `Artifact`, `RemoteTrigger`, `CronCreate`, `PushNotification`, `SendMessage` and `Workflow`, which publish or schedule things no hook here denies | `--tools Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill`. The next run's init listed exactly those eight |

`--bare` is not the answer, despite its name. It skips hooks passed with `--settings`, and it needs an API key.

## Results

**Probes** ([`probes.mjs`](../../spikes/runner/probes.mjs)): two prompts, two arms, three runs each, on Sonnet.
- **The base arm** has a `CLAUDE.md` with one generic line.
- **The head arm's** `CLAUDE.md` imports an `AGENTS.md` that says to use pnpm.

| Probe | Base arm intended | Head arm intended |
|---|---|---|
| "Add lodash as a dependency." | `npm install lodash`, 3 of 3 | `pnpm add lodash`, 3 of 3 |
| "Run the tests." | `npm test`, 3 of 3 | `pnpm test`, 3 of 3 |

No run used the other arm's command. Every run took 2 turns: the agent tried one command, was denied, and reported that a hook had blocked it. It did not try to get around the hook.

**Observe-and-deny:**
- **All 21 runs:** every `Bash` call reached the hook and was denied.
- **No file in any fixture changed:** checked by hashing every file before and after.
- **No `node_modules` or lockfile appeared.**
- **Windows needs `PowerShell` in the deny matcher.** Claude Code has a `PowerShell` tool there, and a matcher of `Bash|Write|Edit` alone would let it through. None of these runs happened to use it.

**What the hooks and the stream expose:**
- **Hook events:**
  - `InstructionsLoaded` gives each file with its `load_reason` (`session_start`, `include`) and `parent_file_path`. The head arm showed `AGENTS.md` loaded by `include` from `CLAUDE.md`.
  - The events arrive in no fixed order, because hooks run asynchronously, so a join must not rely on order.
  - Whether `InstructionsLoaded` fires for an `AGENTS.md` read without an import is S4's question.
- **The `stream-json` output:**
  - the init message: model, tools, plugins, skills and memory paths;
  - every `tool_use` with its full input, so the intended commands and file paths are there without the hook;
  - the final result: turns, duration, usage and cost;
  - a `rate_limit_event` with the subscription window's utilisation.

**Flakiness:** none seen at this size. There were no errors and no timeouts, and every cell was 3 of 3. The commands' wording does vary: the base arm sometimes ran `cd "<run>" && npm install lodash 2>&1 | tail -15 && cat package.json`. So probes must grade the intended command with a pattern, never by exact text.

## Usage

| Per run (Sonnet) | |
|---|---|
| Turns | 2 |
| Duration | median 4.6 s (3.3–8.5 s) as reported; median 7.1 s (6.2–10.8 s) of wall time, including startup |
| Tokens | about 68,000 input including cache reads, about 256 output |
| Cost reported | about $0.044. On a subscription this figure is notional |
| Share of the 7-day window | at most about 0.1%. `seven_day.utilization` went from 0.55 to 0.57 over all 21 runs, but that also counts this session's own work, so it is an upper bound |

**A paired run** (base and head) is about 14 s and well under 0.2% of the weekly window. The design's per-PR default of 24 runs would take about 3 minutes run one after another, well inside its 20 minutes. These probes are one-command tasks. Probes that need the agent to read and reason will cost more turns, and S3 will measure those.

## promptfoo as the wrapper

[`spikes/runner/promptfoo/`](../../spikes/runner/promptfoo/) wraps `run.mjs` as a promptfoo custom provider:
- **The provider** reports a run that changed the fixture as an error.
- **The tests** assert the intended command with a regex.

It worked: 2 of 2 passed with the final config, after a first attempt whose assertion read provider metadata that this version does not expose. What it cost:
- **Node:** the recent releases checked (0.122.0, 0.124.0 and 0.125.1) require Node ≥ 22.22.0 and refuse to start on 22.17.1. ctxlock supports ≥ 22. The spike used 0.120.0 (December 2025), which accepts Node ≥ 20.
- **Size:** about 850 packages for 0.120.0 as installed. The 0.125.1 install was 669 MB of `node_modules`.
- **A native database:** it opens a SQLite database even with `--no-write`. That needs `better-sqlite3`'s install script, which downloads a prebuilt binary. `--no-write` then also left the results file empty.
- **Network by default:** anonymous telemetry, update checks, sharing and remote generation are on unless switched off. [`run.sh`](../../spikes/runner/promptfoo/run.sh) sets `PROMPTFOO_DISABLE_TELEMETRY`, `_UPDATE`, `_SHARING`, `_REMOTE_GENERATION` and a local `PROMPTFOO_CONFIG_DIR`. ctxlock's rule is that no content leaves the machine.
- **What it adds:** a test matrix, assertions, `--repeat` and a results viewer.
- **What it lacks:**
  - arms as a first-class idea;
  - caching the base arm by context digest;
  - variance reporting;
  - joining in the units loaded.

  The design lists all four as ctxlock's own work, and promptfoo would leave them to ctxlock anyway.

## Scored against the design's criteria

| Criterion ([design §6, S1](../superpowers/specs/2026-11-05-ctxlock-design.md)) | Thin harness | promptfoo provider |
|---|---|---|
| **Must:** drive Claude Code headless | Yes | Yes, through the harness |
| **Must:** isolated per run | Yes: copy, run-scoped settings, setting sources, tool allowlist | Same, since the harness does it |
| **Must:** capture transcripts | Yes: `stream-json` and the hook log | Yes, through the harness. promptfoo keeps only the provider's output |
| **Should:** drive a custom agent later (HTTP or MCP) | A second driver function | Built in: promptfoo has HTTP providers |
| Dependencies | None | About 850 packages, a native module, Node ≥ 22.22 for recent releases |
| Nothing leaves the machine | By construction | Only with four environment variables set |
| Arms, base caching, variance, units loaded | To build (needed either way) | To build, inside promptfoo's model |

**Decision:** `ctxlock eval` uses its own runner, built from this harness. The tie-breaker that favours promptfoo, custom agents over HTTP, is a phase-4 concern and a small driver to add. A promptfoo provider can be offered later, for teams already on promptfoo, as an export rather than as the runner.

## Running it in CI

From current Claude Code docs ([GitHub Actions](https://code.claude.com/docs/en/github-actions.md), [authentication](https://code.claude.com/docs/en/authentication.md), [headless](https://code.claude.com/docs/en/headless.md)):
- **On a subscription:**
  - `claude setup-token` makes a one-year OAuth token that "can only make model requests".
  - It goes in the `CLAUDE_CODE_OAUTH_TOKEN` environment variable, or the action's `claude_code_oauth_token` input. Runs then use that person's subscription.
- **With an API key:**
  - `ANTHROPIC_API_KEY`, or the `anthropic_api_key` input. In `-p` mode the key wins whenever it is present.
  - For a secret shared across repositories, the docs recommend an API key from the Claude Console: an OAuth token "is tied to the subscription of the person who ran `claude setup-token`".
- **Not with `--bare`.** The headless docs recommend it for CI, but it does not read `CLAUDE_CODE_OAUTH_TOKEN`, and it drops hooks passed with `--settings`. Both break this harness, so CI runs must use the flags above instead.
- **Not documented:** usage limits or terms for running a personal subscription's token in CI.

## What is left for S3 and Plan 2

- **Model.** These runs used Sonnet to spare the usage window. S3 should run the default model, since that is what teams use.
- **Harder probes.** These were one-command tasks. S3's index-versus-skill questions need reading, so the turns and usage figures here are a floor.
- **Grading.** Grade by pattern over the denied commands and the `tool_use` inputs; never rely on event order.
- **S4.** It reuses this harness, and its first question is whether `InstructionsLoaded` fires for an `AGENTS.md` read without an import.
