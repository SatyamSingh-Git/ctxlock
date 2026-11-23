# `ctxlock check`: is this safe to open? Design

Status: approved by Satyam, 2026-11-24. This is the first of Now 4's five parts (adopter trust), in the order agreed with the Plan 14 session.

## Why

Most context files live in small projects, and skills spread as single folders (`npx skills add`, plugin marketplaces). The person who meets ctxlock first is often working alone. They are about to open a repository, or install a skill, that someone else wrote. The risk report names `npx ctxlock check <path-or-git-url>` as the wedge for that person: one command, no setup, no `ctxlock.yaml`. It tells them whether opening the thing in Claude Code, Codex, Cursor, Copilot or the others would run something, or would feed the agent text they cannot see. It is also the fastest way for a stranger to try ctxlock.

## Goals

- `ctxlock check <target>`, where `<target>` is a local folder or anything `git clone` accepts.
- **Nothing runs, nothing is checked out.**
  - A git URL is fetched with sync's existing fetcher: no checkout, no hooks, no `ext::` transport, and no password prompt. It is read through `gitReader`, at the remote's default branch or at `--ref`.
  - A local folder is only read.
- **Two sections**, then a verdict:
  1. **Runs code when opened:** every execution-config item ctxlock inventories, grouped by file, naming the agent. That covers hooks, MCP servers, setup steps, plugins, auto-approvals, and a skill's `allowed-tools` and hooks. Opaque files say so.
  2. **Must fix:** `must` findings from the safety rules (L0, L1, L2), such as hidden Unicode or a config symlink ctxlock cannot read. `should` findings from those rules follow as "worth a look", for example `curl … | sh` in an instruction.
- **Exit codes:**
  - 1 if section 1 or the must findings are non-empty;
  - 0 if both are empty;
  - 2 for a usage error, or a target that cannot be read or fetched.
- **A bare skill folder** (a folder with `SKILL.md` at its root and no other context file) is checked as a skill. It gets the skill rules and the safety rules, as if it sat at `.agents/skills/<name>/`. Paths in the output stay the folder's own.
- `--format text|json`.

## Non-goals

- Lint quality: budget, coverage, owners, staleness and the rest. `check` answers "is it safe to open?", not "is it good?".
- Probes or anything that runs an agent.
- Packages from npm or other registries, and archives. Git and local folders only.
- A verdict on whether a hook is malicious. ctxlock lists what would run; the person decides.

## Anti-goals

- **Any path that executes the target's content or writes its files to disk.** That rules out a checkout, smudge filters, LFS, submodules, hooks, and a credential prompt that hangs.
- **A clean exit 0 on a target ctxlock could not fully read.** A config symlink that leads outside the target is already an `L2-exec-config-unread` must (D116).

## Approaches

- **A. Reuse `scanRepo` plus sync's `fetchUpstream` (chosen).** The fetcher already clones with no checkout, no hooks and no `ext::`, into ctxlock's cache, and reads through `gitReader`. Discovery already covers every agent (Plan 12a), and the safety rules already gate exactly these things. `check` is a new presentation of what `scan` and `diff` already compute.
- B. GitHub's tarball API. Rejected: it works for GitHub only, has rate limits, and an archive loses the symlinks ctxlock's checks rely on.
- C. Clone with a checkout into a temporary folder. Rejected: a checkout writes files and can run `.gitattributes` filters and LFS smudge. That is the thing `check` exists to avoid.

## Design

- **`src/check.ts`:** `checkTarget(target, { ref?, cache }) → CheckResult`.
  - A target that exists on disk is read with `fsReader`.
  - Anything else goes through `fetchUpstream({ name: target, repo: target, ref: ref ?? 'HEAD' }, cache)`. `HEAD` resolves through `refs/remotes/origin/HEAD`.
  - Then `scanRepo(reader)`.
  - `CheckResult` holds `runs` (the inventory items, grouped by file, each with its agent from `FAMILY_NAMES`), `must`, `worthALook` (`should` findings of L0, L1 and L2), and the commit or folder that was read.
- **Bare skill:** when discovery finds no unit and the target has `SKILL.md` at its root, the reader is mounted under `.agents/skills/<folder name>/` by a small prefixing reader. Paths in findings and items are mapped back before output.
- **`fetchUpstream` sets `GIT_TERMINAL_PROMPT=0`,** so a private or mistyped URL fails at once with exit 2, rather than waiting for a password. This also helps `ctxlock sync` in CI.
- **CLI:** `check <target>` with `--ref` and `--format`. The text output looks like this:

```text
ctxlock check https://github.com/acme/agent-skills (main @ 3f2a9c1)

Runs code when opened (3):
  Claude Code  .claude/settings.json   SessionStart hook runs "./scripts/setup.sh"
  Cursor       .cursor/mcp.json        MCP server db runs "npx -y db-mcp"
  Copilot      .github/hooks/x.json    can change what Copilot runs; ctxlock does not read its format

Must fix (1):
  L1-hidden-unicode  .cursor/rules/api.mdc:4  hidden character U+200B ZERO WIDTH SPACE at 4:12

Worth a look (1):
  L2-risky-instruction  AGENTS.md:12  pipes a download into a shell at 12:1

Review before opening: 3 things run code, 1 must-fix.
```

- **Docs:** `the-guide/check.md`, a section in `the-guide/commands.md`, and one line in the README's Usage section.

## Left to the builder

- The exact wording of the verdict lines, in the style of the existing output.
- The JSON shape: one object with `target`, `read`, `runs`, `must` and `worthALook`.
- The cache folder: the same user cache folder that `eval` and `sync` use.
