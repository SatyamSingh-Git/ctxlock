# ctxlock

**Behavioral CI, a dependency graph, and a feedback loop for AI agent context.**

Teams now run several coding agents at once: Claude Code, Codex, Copilot, Cursor. Each one reads context: `AGENTS.md`, `CLAUDE.md`, skills, rules and MCP tools. That context is a production dependency, but it is managed by hand:
- It is copied between formats.
- Nobody knows which repos and agents depend on which piece.
- Changes ship without anyone checking whether they help or hurt. Research shows they often hurt.

ctxlock adds the missing layer on top of the open formats. It does not replace them.
- **Behavioral diff on every PR.** Did each agent actually load the change? Did its behavior change? What did it cost? Does it fit each tool's limits?
- **Dependency graph.** Which agents in which repos consume each unit of context, and at which version. Changes reach them as reviewed pull requests.
- **Feedback loop.** Agent misses become owned, tested fixes that every consumer receives.

Think of it as dbt + Dependabot + Sentry, for agent context.

## Status

Design phase. Nothing is usable yet.
- [Design and plan](docs/superpowers/specs/2026-11-05-ctxlock-design.md)
- [Research synthesis](research/00-synthesis.md): the state of agent context as of November 2026, with sources
- [Full research notes](research/)

## License

[Apache-2.0](LICENSE)
