# Misses: when the agent was stopped or corrected, what was in its context

When you stop Claude Code partway through, or tell it "no, use the other one", something went wrong. Often that's the agent's own mistake. Sometimes it's the context: a rule that says the wrong thing, a skill that leaves something out, or an instruction file the agent read and didn't follow. `ctxlock misses` puts those moments next to the units that were in context, so a unit that keeps turning up can reach its owner.

It is the first step of the feedback loop. It gives exposure, not a diagnosis: a unit in context when you corrected the agent is a candidate, not a culprit. [`ctxlock diagnose`](#diagnosing-a-unit) is the next step, for one unit at a time.

## What you need

- **[The collector](collector.md),** installed in Claude Code. `misses` reads only the sessions it recorded in the repository, and uses the loads it saw.
- **Claude Code's own transcripts.** It keeps them in `~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects`.

```
ctxlock misses [dir] [--format text|json] [--since YYYY-MM-DD] [--min-sessions <n>] [--excerpts] [--drafts <folder>]
```

## What counts as a signal

- **An interrupt:** you stopped the agent. Claude Code writes `[Request interrupted by user]` into the transcript.
- **A correction:** a prompt you typed, after the agent has answered at least once, whose opening is a correction. That means it starts with "no", "nope", "wrong", "stop", "undo", "revert" or "actually", or with "that's not" or "this is wrong". It also counts when the opening contains "I meant", "I said", "I told you", "not what I", "you forgot", "why did you" or "you should have".
  - Only the first 160 characters are read, with pasted text taken out.
  - A summary Claude Code writes when it compacts a session never counts, though it quotes your earlier prompts.

Each was checked on real transcripts. On 676 of the author's prompts that followed an answer, the phrases matched 5, and all 5 were real corrections. Corrections phrased some other way are missed, and how many is unknown.

**Not counted yet:**
- **A tool use you rejected:** its record wasn't available to check against.
- **Thumbs ratings:** they leave nothing in the transcript.
- **"The right skill wasn't loaded":** needs a diagnosis to mean anything.

## What it reports

```
ctxlock misses · 17 sessions, 6 with a transcript

Signals: 2 interrupted, in 1 session

Units in context when the agent was stopped or corrected:
  instructions/CLAUDE.md  1 session    loaded in 3    routed

Routed at 1 session or more: 1 unit. Write drafts with --drafts <folder>.
```

That is real output, from one of the author's repositories, run with `--min-sessions 1`.

**Units in context:**
- **Which units:** everything the collector saw load in the session before the signal, since the last time Claude Code compacted the session. Claude Code keeps a loaded file in context until then, and loads instruction files again when it compacts, which the collector sees.
- **"In its turn":** counts the signals that came in the same turn the unit loaded, since the prompt before the signal. That is the closer link: a rule that loaded because the agent opened a file, followed by a correction, says more than a `CLAUDE.md` loaded an hour earlier.

**Sessions, not signals, decide what is routed:**
- **One session counts once per unit,** however many times you stopped the agent in it.
- **A session counts half** when every signal in it came after the agent read a web page or an MCP tool's output. Text from outside can steer the agent, so the miss may not be the context's.
- **A unit reached in `--min-sessions` sessions (default 3) is routed:** it has turned up often enough to be worth its owner's time.

**Units loaded in every session** are listed apart. Exposure can't tell them from anything else: they are in context whenever anything goes wrong.

**Signals it can't join are counted:**
- those with no unit of this repository in context, which is every signal in a repository with no `CLAUDE.md`, rules or skills of its own;
- those from before the collector recorded the session, as when it was installed partway through: what was in context then is unknown.

## Drafts for owners

`--drafts <folder>` writes one Markdown note for each routed unit, named after the unit. The note for the unit above, with the repository's address replaced:

```
<!-- ctxlock:miss instructions/CLAUDE.md -->
# ctxlock: `instructions/CLAUDE.md` was in play when the agent was stopped or corrected

- **Belongs in:** `https://github.com/acme/web.git`
- **Owners:** none in ctxlock.yaml or CODEOWNERS
- **Sessions:** 1, of 3 that loaded it
- **Signals:** 2 interrupted, on 2026-11-09
- **Digest today:** `sha256:486ab64c5e45…`

These are signals, not a diagnosis: the unit was in context when the agent was stopped or corrected. Check whether it says something wrong, leaves something out, or was not followed.
```

- **Where it belongs:** the owners come from `ctxlock.yaml` or CODEOWNERS. A unit synced from an upstream ([propagation](propagation.md)) belongs in that upstream, so its note names that repository.
- **What a rerun rewrites:** only a note still exactly as ctxlock wrote it. Its marker line carries a digest of the rest. A note you have edited since, say to add who you sent it to, is left as it is and listed, and so is a file without the marker, which is someone's own. To have ctxlock rewrite an edited note, delete it.
- **With `--excerpts`,** each note also has the opening of each correction you typed:
  - **Redacted:**
    - **Tokens, by the shapes [gitleaks](https://github.com/gitleaks/gitleaks) uses:** GitHub, GitLab, Anthropic, OpenAI and Slack tokens, Slack webhooks, AWS access key IDs, JWTs, and private keys, even cut short.
    - **Values named as secrets:** the value after a word like "secret", "password", "token" or "api key", as in `password: …` or `the secret is …`. An AWS secret key has no shape of its own, so this is how it is caught.
    - **Emails.**
    - **Absolute paths, down to their last part:** a Windows drive, a share (`\\server\…`), `/home`, `/Users`, `/root` and WSL's `/mnt/c/Users`, folders with spaces included.
    - **URL credentials and queries.**
    - **Long runs that look like keys.**
  - **Fenced:** a code fence longer than any run of backticks inside, so no `@mention`, link or markup in it renders.
  - **Read it before you pass it on:** redaction catches shapes, not meaning.

## What `misses` reads, keeps and sends

- **Reads:** the collector's events, and the transcripts of the sessions they name.
- **Keeps:** nothing. What it finds lives in memory while it runs. The only files it writes are the drafts, in the folder you name.
- **Sends:** nothing. It makes no network call and runs no agent.
- **Your words appear only with `--excerpts`,** in the text, the JSON or the drafts.
- **The JSON names sessions,** since it stays on your machine. `ctxlock report`, which is for sharing, has no misses in it.

## Diagnosing a unit

`ctxlock diagnose <unit>` asks Claude what went wrong in the moments the unit was in context, and when the unit is at fault, proposes the smallest fix and checks it by replay. It runs your own `claude`, as [`eval`](evals.md) does, so it costs runs from your plan. A unit need not be routed, but it must have been in context for at least one signal.

```
ctxlock diagnose <unit> [dir] [--format text|json] [--since YYYY-MM-DD] [--runs <n>] [--max-runs <n>] [--max-minutes <n>] [--model <model>] [--claude <path>] [--workdir <dir>] [--drafts <folder>] [--open] [--gh <path>]
```

This is real output, from a repository whose rule said `npm install` while its `package.json` named pnpm, and a session in which the person wrote "no, we use pnpm here" ([report](../docs/dogfood/2026-11-12-diagnose.md)):

```
ctxlock diagnose · rule/.claude/rules/deps.md · 1 session, 1 correction

Verdict: defect
  The file instructs installing packages with npm install, the agent followed it, and the person wanted pnpm.

Rests on:
  Install packages with npm install.

Fix:
  - Install packages with npm install.
  + Install packages with pnpm add (pnpm install for all dependencies).

Probe miss-rule-.claude-rules-deps.md-4d49356f:
  prompt  Add the dayjs package to the project so we can format dates.
  expect  command /pnpm (add|install) dayjs/

Replay, 2 runs a side: validated
  miss-rule-.claude-rules-deps.md-4d49356f  the miss  base 0/2  head 2/2  improved

Runs: 5
```

**What it sends to Claude,** and nothing else:
- the unit's text;
- for each signal it was in context for, the opening of the prompt that began the turn;
- what the agent did in that turn: each tool's name, with its command, path or pattern;
- your correction.

Everything after the unit's text is [redacted](#drafts-for-owners) first. The diagnosing run has no tools, so it can only answer.

**A moment that came after the agent read a web page or an MCP tool's output** is marked so in what is sent, and Claude is told to weigh it less: text from outside may have steered the agent. The output, the proposal and the issue say how many of the signals that was.

**The verdict** is one of:
- **`defect`:** the unit says something wrong;
- **`gap`:** it leaves out what was needed;
- **`preference`:** what you wanted was a one-off, not something the unit should say;
- **`agent-error`:** the unit already says the right thing, and the agent did not follow it;
- **`unclear`:** the moments are too thin to tell.

The reply is checked against the unit: every line it quotes must be in the file, or the diagnosis is refused.

**The fix and the probe,** for a `defect` or a `gap`:
- **Only a correction says what was wanted,** so a unit with interrupts alone gets a verdict and no fix.
- **The fix is one exact replacement** in the unit's text. Its `find` must occur exactly once. It may edit an instructions or rule file, or a skill's `SKILL.md`, never config.
- **The probe** is a task built from your correction and what the agent should then do, as an [`eval` probe](evals.md). Its prompt is redacted again. Its id names the unit and its bytes, so a later fix to the same unit gets a probe of its own.

**The replay** runs the probe, and every probe the unit already has, in two throwaway copies of the repository: one as it is, one with the fix. It runs as `eval` runs, with every command and edit the agent tries denied.
- **"validated":** the probe is `improved`, its pass rate up by at least half, and none of the unit's own probes `regressed`.
- **"not-validated"** is reported as it is. So is **"inconclusive"**: a probe was cut short by `--max-runs` or `--max-minutes`, or has fewer than 2 runs on a side that finished without an error. That is also why `--runs` must be at least 2.
- **How strong it is:** at the default 2 runs a side, 0 of 2 to 2 of 2 is a direction, not proof. `--runs 3` makes 0 of 3 to 3 of 3 a one-sided Fisher p of 0.05, the bar `eval` gates on.
- **Defaults:** `--max-runs` 16 and `--max-minutes` 15.

**A certified unit** is diagnosed and its fix proposed, and the output says the fix needs its owner's approval.

**Nothing is written to the repository,** the fix and the probe included. To take them, apply the diff and commit the probe under `evals/probes/` yourself.

**`--drafts <folder>`** writes the proposal for the unit's owner as `<unit>.fix.md`: the diagnosis, the fix as a diff, the probe as YAML, and the replay. What Claude wrote sits in code spans and fences, so it can't mention anyone or render. A proposal you have edited is left as it is, as notes are.

**`--open` files the proposal as a GitHub issue,** through your own `gh`, in the repository the unit belongs to: this one's `origin`, or the upstream's for a synced unit.
- **Only for a `defect` or a `gap`.** For any other verdict it says so and files nothing.
- **One issue per unit:** the body carries a marker, and a rerun updates the issue it finds instead of filing another. A closed one is reopened too, since the unit missed again after it was closed, and an edit alone notifies no one. An open one is updated quietly.
- **What it holds:** the proposal, exactly as `--drafts` writes it. Nothing from the session itself, not the task, the actions or your words.
- **The repository must be on GitHub.** Anything else is exit 2, before Claude runs.
- **No pull request is opened.** A fix to shared context needs its owner's reading first.
- **Checked on GitHub:** on a scratch repository, it filed one issue, updated it on the next run, and reopened it after it was closed ([report](../docs/dogfood/2026-11-13-github.md)).

## What it doesn't do yet

These are for the next plan:
- **Replay with the unit taken out,** to see whether its absence would have helped.
- **Whether a shipped fix holds** is [`ctxlock outcomes`](outcomes.md)'s.
