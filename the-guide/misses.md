# Misses: when the agent was stopped or corrected, what was in its context

When you stop Claude Code partway through, or tell it "no, use the other one", something went wrong. Often that's the agent's own mistake. Sometimes it's the context: a rule that says the wrong thing, a skill that leaves something out, or an instruction file the agent read and didn't follow. `ctxlock misses` puts those moments next to the units that were in context, so a unit that keeps turning up can reach its owner.

It is the first step of the feedback loop. It gives exposure, not a diagnosis: a unit in context when you corrected the agent is a candidate, not a culprit.

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

## What it reads, keeps and sends

- **Reads:** the collector's events, and the transcripts of the sessions they name.
- **Keeps:** nothing. What it finds lives in memory while it runs. The only files it writes are the drafts, in the folder you name.
- **Sends:** nothing. It makes no network call and runs no agent.
- **Your words appear only with `--excerpts`,** in the text, the JSON or the drafts.
- **The JSON names sessions,** since it stays on your machine. `ctxlock report`, which is for sharing, has no misses in it.

## What it doesn't do yet

These are for the next plan:
- **A diagnosis:** whether a miss is the context's defect, a gap in it, a preference, or the agent's own error.
- **Replay:** re-running the session with a unit taken out or changed.
- **A proposed fix,** validated against the sessions that surfaced it.
- **Opening an issue for the owner.** Until a miss is diagnosed, sending raw signals would cost owners more than it helps.
