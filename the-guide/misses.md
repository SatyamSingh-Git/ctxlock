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
- **An abandoned session:** one you typed into that ended with the agent stopped, in the middle of a tool, or with your prompt unanswered, and has been quiet for at least an hour since. The hour is there because a session still running looks the same. A subagent writes its own transcript while the session waits on it, so the hour runs from the latest line in either. It is counted at its last line's time. Like an interrupt, it says something went wrong, not what you wanted, so `diagnose` gives it a verdict and no fix.

Each was checked on real transcripts. On 676 of the author's prompts that followed an answer, the phrases matched 5, and all 5 were real corrections. Corrections phrased some other way are missed, and how many is unknown.

**Not counted yet:**
- **A tool use you rejected:** its record wasn't available to check against.
- **Thumbs ratings:** they leave nothing in the transcript.
- **"The right skill wasn't loaded":** needs a diagnosis to mean anything.
- **A search that found nothing**, on its own. Agents search and miss all the time: 142 times in the author's 41 typed sessions. As a signal it would drown the rest. It is kept as evidence in a signal's turn instead, below.
- **Clustering corrections by what they say.** Routing already groups signals by unit, across distinct sessions. Grouping them by their text waits until there are enough real ones to check it against: the author's repositories have fewer than ten.

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

**The JSON** has the session counts (`sessions`, `withTranscript`, `withSignal`), `signals` with a count for each kind, `untrusted`, `unattributed`, `unrecorded`, `since` and `minSessions`, then `found`, every signal once, and `units`, whose `kinds` count the same way and whose `signals` are places in `found`. Each kind is always there, zeros included: today `interrupted`, `correction` and `abandoned`, the last added with the abandoned signal. Read the kinds as a set that may grow, not a fixed three: a unit routed only by a kind your code doesn't know is still routed.

## Diagnosing a unit

`ctxlock diagnose <unit>` asks Claude what went wrong in the moments the unit was in context, and when the unit is at fault, proposes the smallest fix and checks it by replay. It runs your own `claude`, as [`eval`](evals.md) does, so it costs runs from your plan. A unit need not be routed, but it must have been in context for at least one signal.

```
ctxlock diagnose <unit> [dir] [--format text|json] [--since YYYY-MM-DD] [--runs <n>] [--extend <n>] [--max-runs <n>] [--max-minutes <n>] [--model <model>] [--claude <path>] [--workdir <dir>] [--ablate] [--drafts <folder>] [--open] [--gh <path>]
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

That run is from before the replay's default became 3 runs a side ([D120](../journey/decisions.md)). Today its replay would be 0/3 against 3/3, 7 runs in all.

**What it sends to Claude,** and nothing else:
- the unit's text;
- for each signal it was in context for, the opening of the prompt that began the turn;
- what the agent did in that turn: each tool's name, with its command, path or pattern, and "found nothing" after a Grep, Glob or MCP search whose result was empty. An MCP tool is a search when its name says it looks something up (search, find, list, query, get, read, fetch, lookup or resolve); one that writes returns nothing when it works. That says what the agent looked for and the unit didn't tell it, which is a gap's evidence;
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
- **"validated":** the probe is `improved`, by the exact test `eval` uses ([what the verdicts mean](evals.md#reading-the-result)), and none of the unit's own probes `regressed`.
- **"not-validated"** is reported as it is.
- **"inconclusive"** is reported as it is too, in one of three cases:
  - a probe was cut short by `--max-runs` or `--max-minutes`, or has fewer than 2 runs on a side that finished without an error;
  - the miss's probe is `uncertain`: the fix looks better, but not by enough runs to show it;
  - one of the unit's own probes is `uncertain` and lower with the fix: it may have got worse.

  The proposal says which, and to run again with more `--runs` or with `--extend`.
- **Why `--runs` must be at least 3:** below 3 runs a side, no result passes the test. At 2 a side the best is 0/2 against 2/2, a one-sided p of 1/6, so no fix could ever be validated. At 3 a side, 0/3 against 3/3 gives 0.05.
- **`--extend <n>`:** runs an `uncertain` probe on to `n` runs a side, then judges it again on every run, as `eval --extend` does. The ablation is not extended. The extension needs room in `--max-runs`: the miss and one of the unit's own probes take 12 runs at 3 a side, and extending the miss to 10 takes 14 more, so `--extend 10` needs `--max-runs 26` or more. When it does not fit, the replay row says `not extended: run budget`, and the proposal says to raise `--max-runs`.
- **Defaults:** `--runs` 3, `--max-runs` 24 and `--max-minutes` 15. 24 fits the miss's probe and two of the unit's own at 3 runs a side, 18 runs, with room left for `--ablate`.

**`--ablate` replays the probe once more, with the unit taken out:** its file, or a skill's whole folder, and any link to it. It compares the repository as it is with the repository without the unit, at the same number of runs a side. The side with the unit is the replay's own base, so only the side without it runs: `--runs` more runs, out of what `--max-runs` has left after the replay, and with its own `--max-minutes`. When too few runs are left, the output says so. The text and the proposal then say which of these it found:
- **`improved`:** taking it out does what was wanted, so the unit itself causes the miss;
- **`unchanged`:** the unit doesn't drive the miss. The agent does the same without it, and a fix that adds what was wanted can still help, as a `gap`'s does;
- **`regressed`:** the unit helps;
- **`uncertain`:** not known. Taking it out looks different, but not by enough runs to show it.

When the miss didn't happen even with the unit in place, it says so instead, since taking the unit out then tells nothing. When runs were cut short or errored, it says which.

It doesn't change "validated", and it runs only when there is a probe; without one, the output says it was not run. A unit reached through a link to a folder is not ablated, since taking out the link would take out what else the folder holds; the output says so.

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
