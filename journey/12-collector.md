# 12. The collector: what Claude Code actually loaded

[Plan 5](../docs/superpowers/plans/2026-11-08-ctxlock-collectors.md) is Phase 2's second plan. Until now, every "loaded" in ctxlock was a prediction, from its model of how each agent reads context. This plan records what Claude Code actually loaded in a developer's own sessions, and puts it beside the prediction.

## What exists now

- **A Claude Code plugin, `ctxlock`,** in the repository's `plugin/` folder; the repository is its own marketplace (D63).
  - It runs on three hooks, and writes one line of JSON per event to `~/.ctxlock/events` (D64).
  - It records paths, digests, reasons and times. It never records content, prompts, tool output or its environment (D66).
- **`ctxlock loads`** lists, for each unit:
  - the sessions that loaded it, how, and when last;
  - how many of them saw another version of it.

  It also lists what the prediction says Claude Code can load but no session did, and says whether a declared consumer covers the sessions.
- **`ctxlock who-uses`** shows the observed sessions beside the predicted loads.
- **`ctxlock eval`'s own load join** reads CRLF as LF, as scans do.
- **The suite** has 522 tests.

## What worked

**A spike before the plan.** [S5](../docs/spikes/S5-collector-plugin.md) took one session with a plugin that dumped every payload it received. Three of its findings decided the design:
- **The plugin's own data folder** is named after how it was installed, so the events live in `~/.ctxlock` instead.
- **A hook inherits the environment of whatever started Claude Code,** tokens included, so nothing of the environment is recorded.
- **Plugins a user installs don't load in ctxlock's eval runs,** so those runs never pollute a developer's records.

**The join was already written.** S4's `joinLoads`, built for eval runs, needed one fix and three functions pulled out to serve a second caller. The new part is mostly counting: once per session, with each session's lines put in time order first. Hooks run asynchronously, and a session's loads arrive before its `SessionStart`.

**The exit criterion, checked live.**
- **The match was exact.** The spec's Phase 2 asks that observed edges match `InstructionsLoaded` ground truth. On S4's fixture, `ctxlock loads` matched Claude Code's raw events exactly: six units, three sessions, every reason.
- **The comparison didn't rest on the collector.** A second plugin recorded the raw events in the same sessions ([report](../docs/dogfood/2026-11-08-collector.md)).
- **Outside files were left out:** the user's own `CLAUDE.md` loaded in every session, and was never listed.
- **`L13` held:** `packages/web/AGENTS.md` never loaded, as `L13` predicts.
- **A real repository worked too.** On plano, a skill the agent invoked was joined to its folder.

**Mutation checks found what the tests missed.** Each case became a test:
- a session started in the repository's parent folder;
- one started outside, which loaded a file inside;
- a folder on another drive;
- lines out of time order;
- an old version loaded twice in one session;
- the same folder reached through a link and through its real path.

Of 75 mutants, 74 were killed. The survivor, the sort of the month files, changes nothing on NTFS, which lists names already sorted. It stays for Linux, which doesn't.

## What broke

- **Eval's digest on a CRLF checkout.**
  - **Found while planning:** `joinLoads` hashed a run copy's raw bytes, while a scan hashes each file with CRLF read as LF. On a Windows checkout, an unchanged unit would read as "other bytes".
  - **Fixed** in its own commit, with a test that failed first.
- **Claude Code dropped a load event.**
  - In one live session of six, no `InstructionsLoaded` fired at all, not even for the user's own `CLAUDE.md`. The dump plugin saw nothing either, and a rerun reported it.
  - It isn't ctxlock's to fix. A session count can be one short, and the guide says so.
- **The final review found the list of units nobody loaded wrong in two monorepo layouts.**
  - **What it reproduced:**
    - In a repository with no `CLAUDE.md`, every `AGENTS.md` below the top showed as not loaded, though Claude Code reads them without reporting it.
    - Every session was judged as if it had started at the top. So a package's skill, invoked from the package's own folder, showed as never loaded.
  - **The fix:** each session is now judged by the folder it started in. What Claude Code never reports is left out, and `who-uses` shows "0 of N" only for a unit a session could be seen loading.
  - **Why it mattered:** the guide calls that list the candidates to delete.
- **A shell edit ran stray commands.** Markdown with backticks went through `node -e` inside bash double quotes, and bash ran the backticked spans. Nothing shipped ([mistakes](mistakes.md)).

## What was learned

- **The gap between prediction and observation is known, and it is where it matters most.**
  - A repository with only an `AGENTS.md` is the setup every agent reads, and there Claude Code reports nothing at all.
  - A collector built only on hooks would say those repositories load nothing.
  - The prediction fills exactly that gap, and the label says which loads are which.
- **"Not loaded" is the useful list, and it needs many sessions.** After one session, plano listed four skills nobody had used yet. After one session that's noise; after fifty it's a list of candidates to delete.
- **What a hook can see bounds what a collector can claim.** No payload names the model, and no hook lists the skills a session was offered. The guide says so rather than guessing.
