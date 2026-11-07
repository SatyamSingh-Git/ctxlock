# Build: one repository, every agent's context

`ctxlock build` shows what each agent loads from your repository, where one agent misses something another one reads, and where two hand-written files say different things. With `--fill-missing`, it writes the files that close those gaps, and it never writes over a file a person wrote or edited.

> **Status:** implemented and tested. Claude Code and Codex are the agents it fills for, since they are the ones ctxlock can predict. Cursor and Copilot come later, with [rulesync](https://github.com/dyoshikawa/rulesync) writing their formats ([D49](../journey/decisions.md)).

```sh
ctxlock build                     # report; writes nothing
ctxlock build --fill-missing      # write what is missing, and record it
ctxlock build --suggest-index docs  # print a docs index for AGENTS.md; writes nothing
```

## The report

This is real output, from the fixture used to test rulesync (spike [S2](../docs/spikes/S2-rulesync.md)). The repository has an `AGENTS.md` with the team's conventions, a `CLAUDE.md` that does not import it, a skill in `.agents/skills`, and a rule in `.claude/rules` for `src/api/**`:

```
Budget:
harness      site  always bytes  skill catalog  cut
claude-code  .     40            0              -
codex        .     77 / 32768    85 / 8000      -

Budget after --fill-missing:
harness      site     always bytes  skill catalog  cut
claude-code  .        40            63             -
claude-code  src/api  40            63             -
codex        .        77 / 32768    85 / 8000      -
codex        src/api  136 / 32768   85 / 8000      -

Gaps:
  .agents/skills/release does not reach claude-code  fill: .claude/skills/release (a copy of the skill)
  .claude/rules/api.md does not reach codex          fill: src/api/AGENTS.md (an AGENTS.md from what Claude Code loads there)
  AGENTS.md does not reach claude-code               no fill: edit by hand: add @AGENTS.md to CLAUDE.md
  CLAUDE.md does not reach codex                     no fill: add it to AGENTS.md by hand

Drift:
  CLAUDE.md and AGENTS.md: 2 lines only in CLAUDE.md, 3 only in AGENTS.md

ctxlock build --fill-missing writes the 2 fills above.
```

- **Budget** is the same table as [`ctxlock budget`](commands.md#ctxlock-budget). With fills planned, a second table shows it after they are written. After `--fill-missing`, the first table is the budget as the fill left it.
- **Gaps** are files one agent reads and the other does not, with the file that would close each gap, or the reason there is none. A file the agent reads through a generated copy that is out of date `reaches claude-code out of date`. The closing line counts each file to write once, however many gaps it closes.
- **Drift** is two files written by hand that serve the same folder for different agents and differ:
  - two copies of a skill, one in `.claude/skills` and one in `.agents/skills`, whose files differ;
  - a `CLAUDE.md` and the `AGENTS.md` beside it, when the `CLAUDE.md` does not import it. The counts are of distinct, non-empty lines.
- **Generated** lists each file in `.ctxlock/generated.json` with its state: up to date, stale, edited by hand, missing, or a source that is gone.

`--format json` gives the same report as JSON.

## What `--fill-missing` writes

Only for gaps between Claude Code and Codex, and only these three kinds of file:

| Gap | What is written |
|---|---|
| A skill in `.agents/skills` (Codex only) or `.claude/skills` (Claude Code only) | A byte-for-byte copy in the other agent's folder, beside it |
| An `AGENTS.md` that Claude Code skips because a `CLAUDE.md` exists higher up, in a folder with no `CLAUDE.md` of its own | That folder's `CLAUDE.md`, containing `@AGENTS.md`, the fix [`L13`](rules.md#l13-agents-md-shadowed-should) gives |
| A folder whose `CLAUDE.md`, `.claude/CLAUDE.md` or unscoped `.claude/rules` Codex never sees, with no `AGENTS.md` | `AGENTS.md`, assembled from what Claude Code loads there: the `CLAUDE` files, the files they import (as far as Claude Code follows imports, four hops), then the rules, without their frontmatter |
| A `.claude/rules` file whose `paths` are whole folders, such as `src/api/**` | `src/api/AGENTS.md` from the rule, which Codex then loads only when it works in that folder |

Everything else stays a gap, with its reason:
- a rule scoped by another kind of glob (`Codex cannot scope **/*.ts`), or by an empty `paths` list;
- a folder that already has an `AGENTS.md` or `AGENTS.override.md` (`add it to AGENTS.md by hand`);
- an import a person has to add to an existing `CLAUDE.md`;
- a file git would ignore (`.claude/skills/release/SKILL.md is gitignored`), by any rule git reads: a `.gitignore`, `.git/info/exclude` or your global excludes. When git ignores `.ctxlock/generated.json` itself, nothing is filled;
- a skill with files reached through a symlink (`files reached through a symlink; copy by hand`).

## What it never does

- **Write over a file a person wrote, or edited since ctxlock wrote it.** A file is ctxlock's to rewrite only if `.ctxlock/generated.json` lists it and its contents still match the record. That is checked again just before writing, and anything else is listed under "Left as it is". A fill's files are written together or not at all, so a copy never lands in part in a folder a person has, such as one whose name differs only in case.
- **Write a file an agent would cut, or one that makes an agent cut a file it loads in full today.** Each planned file is checked against the agents' limits before anything is written. An `AGENTS.md` that would take Codex over its 32,768 bytes stays a gap, and its reason quotes the limit. So does a root `AGENTS.md` that would leave Codex no room for a folder's own: `would cut pkg/AGENTS.md: ...`.
- **Copy execution config** (settings, MCP files), or read your gitignored `CLAUDE.local.md`. Generated files are meant to be committed, and personal files should not decide what goes in them.
- **Write outside the repository,** or through a symlink or a Windows junction, including one git does not list. Each part of each path is checked as the file is written.
- **Mark the files themselves.** The record is `.ctxlock/generated.json`, kept beside your other config.

Running it again writes nothing until a source changes, including on a checkout that turned LF into CRLF. When a source changes, the file made from it is rewritten, as long as nobody edited it. When a skill no longer has a file, its copy loses that file too, on the same condition, listed under "Removed".

## `.ctxlock/generated.json`

Commit it with the generated files. It lists each generated file with the digest of its contents and of each file it came from:

```json
{
  "version": 1,
  "files": [
    {
      "path": "src/api/AGENTS.md",
      "sha256": "f39ed7132ac386d4b2228bca54022037b99dfca9159dc2e43e5805b1e382687b",
      "from": [{ "path": ".claude/rules/api.md", "sha256": "fc9ed21a115dbb681af1d1c33bf0be2a9649337ae5ab64b7de89e60513070570" }]
    }
  ]
}
```

Digests are taken with CRLF read as LF, as unit digests are, so a Windows checkout and a Linux one agree. [`L14-generated`](rules.md#l14-generated-should) uses the record to report a generated file that went stale or was edited, in `lint`, `diff` and the pull request check. [`L11`](rules.md#l11-coverage-info) and [`L13`](rules.md#l13-agents-md-shadowed-should) use it too: a skill and its copy reach both agents between them, and nobody is told to import an `AGENTS.md` that was generated from `CLAUDE.md`.

To stop generating a file, delete it and its entry. To keep your own edit of a generated file, delete its entry, and the file is yours.

If the record is not valid JSON, or names a path outside the repository, `--fill-missing` stops with exit 2, since it would otherwise replace the record and lose its entries. The report without it says so too.

## A docs index for `AGENTS.md`

```
$ ctxlock build --suggest-index docs
[docs index]|root: ./docs|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning|.:{a.md}|guide:{b.md,c.mdx}

127 bytes. Not written. Measure it with a probe before you commit it: see the-guide/build.md.
```

This is the compressed index from Vercel's ["AGENTS.md outperforms skills"](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (January 2026): every markdown file under the folder, grouped by subfolder, in the format of Next.js's own `agents-md` codemod. In Vercel's evals, an 8 KB index like this in `AGENTS.md` reached 100% where skills reached 53–79% ([research/03](../research/03-evidence-what-context-works.md)).

That result came from an index of a framework's own docs, used for tasks about that framework. Whether an index of your repository's docs helps your agents is a separate question, so ctxlock only prints it. Before you commit one:
1. Paste it into `AGENTS.md` on a branch.
2. Write a [probe](evals.md) for a task that needs a doc the agent would otherwise not find.
3. Run `ctxlock eval --base main` and see whether the head passes where the base does not.

The index lists file names only, so it stays small; check the bytes it prints against your agents' budgets. The folder is taken from the directory `build` runs on, and the index names it from the repository's top, so `ctxlock build sub --suggest-index docs` gives `root: ./sub/docs`.
