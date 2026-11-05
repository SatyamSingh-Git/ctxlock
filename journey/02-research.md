# 2. The research

About 400 primary sources across the eight tracks. The synthesis is in [research/00-synthesis.md](../research/00-synthesis.md); this chapter records what was found and what it changed.

## What was found

**The file formats are settled.**
- AGENTS.md, Agent Skills and MCP are all governed by the Linux Foundation's Agentic AI Foundation.
- About 80 agents read skills.

So inventing a format would be fighting a standard that has already won. ctxlock reads the existing formats as they are.

**The plumbing is largely built, and it is open source:**
- rulesync compiles one source into about 70 agents' file formats (MIT, 1.14M npm downloads a month).
- Microsoft's APM provides a manifest, a lockfile with content hashes, policy files, drift audit and an SBOM.
- Vercel's `skills` installs skills into 79 agents.
- Atlan open-sourced a v0.1 "AI Registry" spec at the conference itself.

**What nobody has built in the open** is the layer the keynote calls the nervous system:
- a record of which agents depend on which context, both declared and observed;
- tests that run the dependent agents' evals when shared context changes;
- a join between what an agent actually loaded and the source file and version it came from;
- a loop that sends an agent's miss to the person who owns that context.

Closed products have pieces of this: Atlan Trident, Databricks Unity Gateway, Decagon Autopilot, Promptless, Tessl. None is open, git-native, or works with any agent.

## What the keynote got wrong

Tracing every number back to its source changed several of them:

| The keynote said | The source says |
|---|---|
| Agents open a given skill 46% of the time | Real, but it is the *worst* of 18 configurations; the range is 46–99%. The paper itself says discovery is "usually not the bottleneck". |
| 49% load all needed skills, 31% with distractors; success 51% → 44% | Real, but one model only (Claude Opus 4.6) |
| Vercel: 53% as a skill vs 100% as an index | 53% is a *pass rate*, the same as having no docs at all, because the skill was never invoked in 56% of runs. The 100% came from an 8KB pipe-delimited index pointing at files on disk. |
| A bank abandoned 90% of its agents | No public source found |
| A sales agent kept pitching old positioning | Real, and it was Atlan's own website agent |

## What the keynote undersold

**Context often makes agents worse.**
- LLM-written AGENTS.md files lowered success and raised cost by about 20% (ETH Zurich).
- Self-generated skills scored 8–11 points below having no skills at all (SkillsBench).
- "Comprehensive" skills added +0.7 points, against +21.5 for skills of standard length.

So "manage context like code" has to include *measuring whether context helps, and deleting what doesn't*. That idea became a design principle: never auto-generate context, never auto-merge it.

## Security

A shared context layer is an attack surface:
- 1,184 malicious skills on ClawHub;
- the "Rules File Backdoor": invisible Unicode in rules files;
- a planted AGENTS.md that hijacked Codex in more than 90% of runs;
- CVEs in Claude Code, Cursor and Copilot through hooks, base URLs and auto-approve settings.

Scanners caught a minority of the malicious skills: 7.7% with rules alone, 33.7% with an LLM judge. That is why hidden characters and execution-affecting config are the first two lint rules (L1, L2), and why both are MUST.

## Problems along the way

- **Every research track ran out of web-search budget partway through.** All eight agents shared one budget. Claims they could not re-check are marked in their reports. Before building on any of them, the load-bearing ones were re-verified directly: agnix's JSON format, every license, the CLI flags, Codex's loader tests. See [mistakes](mistakes.md).
- **The landscape track missed the most important comparable**, Atlan's AI Registry spec. The keynote track found it, and the synthesis now cross-checks each track against the others.
- **One agent reported the C: drive at 0 MB free.** It was 2.6 GB when checked. Everything since lives on F:.

## What we learned

- Re-source every number before quoting it, even from a credible keynote.
- The gap is not formats or plumbing. It is the graph, the behavioral CI and the feedback loop.
- The strongest evidence-backed design rule: **keep a compact index always loaded, and fetch the content on demand.** Never make critical context depend on the model choosing to fetch it.

Next: [03 — the design](03-design.md).
