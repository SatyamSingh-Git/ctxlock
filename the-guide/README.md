# The Guide

Everything you need to install ctxlock, run it, understand what it tells you, and get unstuck.

> **Not on npm yet.** ctxlock is pre-alpha. `scan`, `lint`, `budget` and `diff` work when built from source ([commands.md](commands.md) shows how). Each page below is written when its feature ships, so this guide only ever describes things that exist; [the design](../docs/superpowers/specs/2026-11-05-ctxlock-design.md) describes what is planned.

If something here is wrong, out of date, or simply does not work, open an issue on [the repository](https://github.com/SatyamSingh-Git/ctxlock/issues). A report that says "I ran X, expected Y, got Z" is worth more than a polite one.

---

## Start here

| Page | What it covers | Status |
|---|---|---|
| installation.md | Requirements, install, and how to check it works | Arrives with the first CLI release |
| [commands.md](commands.md) | `ctxlock scan`, `lint`, `budget`, `diff`: every flag, and what the output means | Written |
| [configuration.md](configuration.md) | `ctxlock.yaml`: harnesses, owners, trust tiers, limit overrides, rule severities | Written; format and validation implemented |
| [rules.md](rules.md) | Every lint rule: what it checks, why (with the research behind it), and how to fix a finding | Written for every rule built so far: L0–L11 and L13 |
| [agents.md](agents.md) | What ctxlock predicts each agent loads, and how that prediction is checked | Written; Claude Code and Codex predictions implemented |
| github-action.md | Adding the PR check to a repository: permissions, `fetch-depth: 0`, fork PRs | Arrives with the Action |
| troubleshooting.md | What goes wrong, why, and the fix | Arrives after the first dogfood pass |
