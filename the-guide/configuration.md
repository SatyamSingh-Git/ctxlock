# Configuration: `ctxlock.yaml`

`ctxlock.yaml` is optional. Without it, ctxlock checks your repository with sensible defaults and takes owners from CODEOWNERS. Add it when you want to record ownership and trust, override a harness limit, or tune a lint rule.

Agents never read this file. It is for ctxlock and for the people reviewing context changes, the way `CODEOWNERS` is.

> **Status:** the file format and its validation are implemented. The commands that read it (`ctxlock scan`, `lint`, `budget`, `diff`) arrive with the first CLI release.

## A complete example

```yaml
version: 1

# Which coding agents your team uses. Load and limit checks for an agent that isn't listed are skipped.
harnesses: [claude-code, codex]

# Per-unit ownership and trust. Keys are unit paths: a file, or a skill's directory.
units:
  AGENTS.md:
    owner: "@platform-team"
    tier: certified            # certified | reviewed | imported | proposal
    verified-at: 2026-10-01
    stale-after: 2027-01-01
    sources: [https://wiki.example.com/engineering-standards]
    depends-on: [.agents/skills/release-notes]
  .agents/skills/release-notes:
    owner: "@docs-team"
    tier: reviewed

# Override a harness limit if a vendor changes it before ctxlock does.
limits:
  codexChainBytes: 65536

lint:
  severity:
    L1-html-comment: should    # must | should | info | off
  ignore:
    - "vendor/**"
```

Quote owners that start with `@`; YAML reserves that character.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Always `1` |
| `harnesses` | no | Any of `claude-code`, `codex`. Defaults to both. Load predictions, budgets (L3, L5), coverage (L11) and the AGENTS.md check (L13) run only for the agents listed. Config that runs code (L2) is listed for every agent, since anyone can run any agent on a checkout. |
| `units.<path>.owner` | no | The person or team accountable for this unit. Overrides CODEOWNERS. |
| `units.<path>.tier` | no | How much to trust it: `certified`, `reviewed`, `imported` (third-party), or `proposal` (suggested, not yet approved) |
| `units.<path>.verified-at` | no | When someone last checked it, as `YYYY-MM-DD` |
| `units.<path>.stale-after` | no | When it needs checking again, as `YYYY-MM-DD` |
| `units.<path>.sources` | no | Where the content came from |
| `units.<path>.depends-on` | no | Other units this one relies on |
| `limits.<name>` | no | A non-negative integer overriding a harness limit (see below). `0` is allowed; Codex treats it as "load no AGENTS.md". |
| `lint.severity.<rule>` | no | Change a rule's severity, or turn it `off` |
| `lint.ignore` | no | Globs of paths whose findings are dropped |

Unit paths are repo-relative with `/`, e.g. `packages/api/AGENTS.md`. A skill is keyed by its directory (`.agents/skills/release-notes`), not by its `SKILL.md`.

## Validation

ctxlock rejects anything it doesn't recognise rather than silently ignoring it. A typo names its exact location:

```text
ctxlock.yaml: units.AGENTS.md.ownr: unknown key
ctxlock.yaml: units.AGENTS.md.tier: Invalid option: expected one of "certified"|"reviewed"|"imported"|"proposal"
```

Dates stay as written. `2026-10-01` is read as the text `2026-10-01`, not converted to a timestamp.

## Owners

For each unit, ctxlock uses the first owner it finds:
1. `units.<path>.owner` in `ctxlock.yaml`.
2. Otherwise, CODEOWNERS:
   - The first file found among `.github/CODEOWNERS`, `CODEOWNERS` and `docs/CODEOWNERS` is used.
   - As on GitHub, the **last** matching line wins, and a pattern with no owners after it leaves the path unowned.
   - Also as on GitHub, matching is case-sensitive, and `docs/*` covers files directly in `docs/` but not `docs/a/b.md`.
   - A skill is matched through its `SKILL.md`, so a directory pattern such as `.agents/skills/x/ @team` owns it.

## Limits you can override

Defaults were checked against each vendor's documentation on 2026-11-05.

| Name | Default | What it is |
|---|---|---|
| `codexChainBytes` | 32768 | Codex's combined budget for the AGENTS.md chain (`project_doc_max_bytes`) |
| `codexSkillCatalogChars` | 8000 | Codex's skill catalog budget when the context window is unknown |
| `claudeSkillEntryChars` | 1536 | Claude Code's cap on one skill's `description` + `when_to_use` in its listing |
| `claudeLazyFileChars` | 40000 | Claude Code's per-file cap for lazily loaded CLAUDE.md, CLAUDE.local.md, AGENTS.md and rules (200K window; 1M-context models allow 150,000–200,000) |
| `claudeLaunchFileBytes` | 4194304 | Claude Code skips launch files larger than 4 MiB |
| `claudeImportHops` | 4 | How deep Claude Code follows `@path` imports |
| `devinCloudFileBytes` | 16384 | Devin cloud reads the first 16 KiB of each AGENTS.md |
| `skillNameMax` | 64 | Agent Skills spec: maximum `name` length |
| `skillDescriptionMax` | 1024 | Agent Skills spec: maximum `description` length |
| `skillCompatibilityMax` | 500 | Agent Skills spec: maximum `compatibility` length |
| `skillDescriptionPortable` | 1000 | The lowest description limit among common clients |
| `skillBodyLines` | 500 | Recommended maximum length of a SKILL.md body, in lines |
| `skillBodyChars` | 20000 | Recommended maximum, in characters (about 5k tokens) |
| `alwaysOnInstructionItems` | 150 | Always-on instructions beyond which frontier models start dropping some |
