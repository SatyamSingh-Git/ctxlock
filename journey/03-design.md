# 3. The design

The design is in [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../docs/superpowers/specs/2026-11-05-ctxlock-design.md).

## The shape

The positioning that came out of the research was **dbt + Dependabot + Sentry, for agent context**:
- **dbt:** a dependency graph, tests and slim CI over plain files.
- **Dependabot:** changes reach every consumer as reviewed pull requests.
- **Sentry:** agent misses become owned, triaged issues.

The keynote's triangle mapped onto three entities:
- **Actors:** owners (from CODEOWNERS or `ctxlock.yaml`) and consumers (agent configurations that use context).
- **Artifacts:** *units*, meaning each skill, rule and instruction file, addressed by content digest and kept in its native format.
- **Activity:** events recording what loaded, how runs did, and what users corrected.

The phases ran from cheapest-to-prove to most ambitious:
1. Behavioral CI.
2. The dependency graph and propagation.
3. The feedback loop.
4. Business context.
5. Open specs, earned by a working reference implementation.

## The builder check

Before the design went to Satyam, a fresh reviewer read it as if they had to build it, and reported only the questions that would change the plan. It raised seven. Two exposed real flaws:

1. **The per-PR eval suite couldn't see what it was meant to catch.**
   - The draft ran 40 cases × 3 runs per PR. That only detects pass-rate swings of about 10 points or more.
   - The harms in the research are often 0.5–3 points; ETH needed about 440 instances to reach p ≈ 0.04.
   - **Fix:** each PR check now leads with signals that are large and cheap to measure:
     - *adherence probes*: does the agent follow the rule?
     - *trigger probes*: does the skill load?
     - which units actually loaded;
     - cost.

     Full statistical evals run on a schedule or a label.
2. **A repo with no eval tasks got nothing.**
   - **Fix:** probes are drafted from the context itself, reviewed once, and committed.
   - They are tests, not context, so the "never auto-generate context" principle doesn't apply.

The other five became recorded calls:
- trust metadata lives in a `ctxlock.yaml` registry, because AGENTS.md has no frontmatter;
- in phase 1, `build` reports and fills gaps but never overwrites;
- edges travel through lockfiles and an opt-in report, with no server;
- the runner must also be able to drive custom agents;
- the name must be decided before the first publish.

## Satyam's answers

Three questions went to Satyam: who is the first user, who the project is for, and the name. His reply:

> Its an OSS, For: Developer teams running several coding agents
> this looks good if its not used: ctxlock

**Checking the name `ctxlock`.**
- GitHub org name, npm (`ctxlock` and `@ctxlock`), PyPI and crates.io: all free.
- ctxlock.com, .dev, .io and .org: unregistered according to the registries' own lookup service (RDAP), with google.com as a control.
- The only other "ctxlock" projects are small Go mutex libraries, a different domain.

**Then the repository:**

> here is the repository: https://github.com/SatyamSingh-Git/ctxlock.git

It was empty and public. The research, design, README and the canonical Apache-2.0 LICENSE went up as the first commit. GitHub detects the license.

Next: [04 — the plan](04-plan.md).
