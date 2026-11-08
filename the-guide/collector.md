# The collector: what Claude Code actually loads

ctxlock predicts which files each agent loads; that prediction is what `ctxlock budget` and `ctxlock who-uses` show. The collector records what Claude Code actually loaded in your own sessions. From that you can see:
- which rules and skills are used;
- which never are;
- whether the prediction holds.

> **Status:** implemented and tested, for Claude Code. Checked live against Claude Code's own load events ([report](../docs/dogfood/2026-11-08-collector.md)).

## Installing it

The collector is a Claude Code plugin, in ctxlock's repository:

```sh
claude plugin marketplace add SatyamSingh-Git/ctxlock
claude plugin install ctxlock@ctxlock
```

Inside Claude Code, the same commands work as `/plugin marketplace add SatyamSingh-Git/ctxlock` and `/plugin install ctxlock@ctxlock`. The plugin runs a small Node script, so it needs `node` on your `PATH`, as ctxlock does.

After a few sessions, run these in a repository:
- [`ctxlock loads`](commands.md#ctxlock-loads), which lists what loaded and what never did;
- `ctxlock who-uses <unit>`, which adds how many sessions loaded that unit.

## What it records

The script runs on three Claude Code hooks. Each event becomes one line of JSON in `~/.ctxlock/events/<YYYY-MM>.jsonl`:

| Event | When | What the line holds |
|---|---|---|
| `session_start` | A session starts or resumes | The session's ID and folder, and how it started (`startup`, `resume`, …) |
| `load` | Claude Code loads an instruction file (`InstructionsLoaded`) | The file's path, a SHA-256 of its text (with CRLF read as LF, as `ctxlock scan` hashes it), why it loaded, and the file that triggered or imported it |
| `skill` | The agent invokes a skill | The skill's name |
| `error` | The collector could not record an event | A message |

Every line also has its time. Every line but an `error` also has `"harness": "claude-code"`.

**It never records:**
- a file's content;
- a prompt or a reply;
- a tool's input, other than a skill's name;
- a tool's output;
- the model;
- environment variables.

Environment variables matter here: a hook inherits the environment of whatever started Claude Code, tokens included.

**Loads from every folder are recorded,** your own `~/.claude/CLAUDE.md` included. `ctxlock loads` and `who-uses` keep only what is inside the repository you run them on.

**The collector never gets in a session's way.** It prints nothing, and exits 0 whatever it is given. When it can't record an event, it writes an `error` line instead, and `ctxlock loads` reports those.

## Where the events live, and how to remove them

- **The events** live in `~/.ctxlock/events`. If `CTXLOCK_HOME` is set, they go in `$CTXLOCK_HOME/events` instead. They are never written into a repository, and they never leave your machine. Delete the folder to forget them.
- **To pause the collector:** `claude plugin disable ctxlock@ctxlock`.
- **To remove it:** `claude plugin uninstall ctxlock@ctxlock`.
- **ctxlock's own eval runs are not recorded** when the plugin is installed for your user, as the commands above do. Eval runs start Claude Code with `--setting-sources project`, which loads no plugin installed for the user.

## What it can't see

- **An `AGENTS.md` read through Claude Code's fallback.**
  - With no `CLAUDE.md`, Claude Code reads `AGENTS.md` through a built-in plugin that reports nothing, though the agent follows the file ([S4](../docs/spikes/S4-telemetry.md)).
  - ctxlock adds the loads at a session's start from its own prediction, marked `(predicted)`.
  - An `AGENTS.md` further down, which Claude Code reads once the agent works in its folder, can't be counted at all. So it is never listed as not loaded.
- **A skill below the folder a session started in.**
  - Claude Code offers the skills of the start folder and of every folder above it, and ctxlock credits a call to those.
  - A skill Claude Code finds further down, once the agent works there, isn't credited. Its name could be one of Claude Code's own skills, such as `simplify`, so it isn't listed as not loaded either.
- **Which skills a session was offered.** Claude Code lists skills when a session starts, and no hook reports that list. So for a skill, "not loaded" means never invoked.
  - A skill with `disable-model-invocation: true` is never offered to the model. ctxlock neither predicts it nor reports it as not loaded.
- **A load Claude Code doesn't report.**
  - In one live session of six, Claude Code sent no load event at all, not even for the user's own `CLAUDE.md` ([report](../docs/dogfood/2026-11-08-collector.md#a-session-that-reported-nothing)).
  - So a count can be one short, and "Not loaded in these sessions" means more after many sessions than after a few.
- **The model.** No hook payload names it ([S5](../docs/spikes/S5-collector-plugin.md)).
- **Other agents.**
  - Collectors for Codex, Copilot CLI and Cursor wait for someone with access to those tools.
  - Until then, their loads are predicted only ([agents](agents.md)).
- **Other clones of the same repository.** Loads are matched by folder, so a session in another clone counts only when you run `ctxlock loads` on that clone.
