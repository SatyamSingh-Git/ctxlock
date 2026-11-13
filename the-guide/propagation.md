# Propagation: shared skills and rules across repositories

Most teams that write context for agents soon want the same skill or rule in several repositories. Copying it by hand works once. After that the copies drift: one repository gets the fix, the others keep the old text, and nobody can say which version a service runs with.

ctxlock treats shared context as a dependency:
- **An org repository** holds it.
- **Each repository that uses it** names what it takes in `ctxlock.yaml`.
- **`ctxlock sync`** brings those units in.
- **`ctxlock.lock`** pins what sync brought in, so any change to it arrives as a diff someone reviews.

> **Status:** built and tested, and checked live on local repositories ([report](../docs/dogfood/2026-11-10-propagation.md)). The workflow template has been tested against a stand-in for `gh`, but has not yet run on GitHub.

## The org repository

Any git repository works. Put skills and rules in it where an agent would find them, as in any repository: skills under `.agents/skills/` or `.claude/skills/`, rules under `.claude/rules/`. Its own `ctxlock.yaml` can give each unit a `tier`. A unit keeps that tier in every repository that syncs it ([below](#trust-tiers)).

Check it like any other repository: `ctxlock lint`, the [Action](github-action.md) on its pull requests, and [probes](evals.md) for the units that matter.

## Taking units from it

In the repository that uses them, name the upstream and the units you want:

```yaml
# ctxlock.yaml
version: 1
upstream:
  platform:
    repo: https://github.com/acme/org-context.git
    ref: main
    units: [.agents/skills/release, .claude/rules/deps.md]
```

- **`repo`** is any git URL, or a path. A path starting `./` or `../` is beside this repository.
- **`ref`** is a branch, a tag or a commit. It defaults to `main`.
- **`units`** lists the units you take, as paths in the upstream. Each lands at the same path here.
- **`allow-exec`** lists the units you take though their frontmatter runs hooks or grants tools ([below](#what-never-syncs)).

Then run [`ctxlock sync`](commands.md#ctxlock-sync), and commit what it wrote together with `ctxlock.lock`.

## What never syncs

- **Instructions files** (`AGENTS.md`, `CLAUDE.md`) are each repository's own. Naming one in `units:` stops sync with exit 2.
- **Config** never syncs: settings, hooks and MCP registrations. Inside a skill, sync leaves out any `hooks/` folder, `settings.json`, `settings.local.json` and `.mcp.json`, and lists each one it left out.
- **A skill whose frontmatter runs hooks or grants tools** (`hooks:` or `allowed-tools:`) is refused, since Claude Code runs those without asking while the skill is active. To take one, name it under `allow-exec:` for its upstream, after reading what it runs. Sync then lists it in every report, so the pull request says so even when no check runs on it.
- **A file inside a skill that is a link** to something outside the skill is left out, and listed.
- **A file sync didn't write is never overwritten,** whether git tracks it, ignores it, or doesn't know it.
- **A synced file edited here is never overwritten.** Sync refuses, writes nothing, and exits 1. Nor is it removed: when its unit leaves `units:`, or its skill no longer has it, sync leaves it as yours and drops it from the lock.

These rules come from the design's §7. Shared context runs in every repository that takes it, so anything that could run a command, or change what an agent may do, stays a decision each repository makes for itself.

## `ctxlock.lock`

```yaml
lockfile_version: 1
upstreams:
  - name: platform
    repo: ../org
    ref: main
    commit: a6f8b4720693d4b4ac3290a0ce9abe333d16c2b4
    units:
      - path: .agents/skills/release
        id: skill/.agents/skills/release
        digest: sha256:3ded5211cd5d0a5795da2cad69ec74532fc35f9f395a257659032c07db9c3790
        tier: certified
        files:
          .agents/skills/release/SKILL.md: 02b01dd6ebe732ed84755b123aa257ffd1862a6f0bb4d0267c2fd3720d227955
```

It has the shape of [APM](https://github.com/microsoft/apm)'s lockfile:
- **Each upstream** has the commit sync read.
- **Each unit** has its digest and its tier upstream.
- **Each file** sync wrote has a digest, of the file read as LF.

The lock is rewritten only when what it says changes. When the upstream moves but nothing this repository takes has changed, the lock keeps the commit it has, so there's nothing to review.

[`L16-lock`](rules.md#l16-lock-must-should) checks the lock on every `lint`, `diff` and Action run:
- a synced file edited by hand, or missing, is a `must`;
- an entry `ctxlock.yaml` no longer declares is a `should`.

## Changing a synced unit

Change it in the org repository, then sync. To keep a version of your own instead, edit it and take the unit out of `units:`. Sync then removes the files it wrote that nobody edited, leaves the edited ones as yours, and drops the unit from the lock.

## Trust tiers

A synced unit's tier is the one the org repository gives it, as `ctxlock.lock` records it. An entry in your own `units:` can't raise it: the tier belongs to whoever owns the unit. `L15`'s tier checks, `who-uses` and `impact` read it from the lock.

## What a change upstream reaches

In the org repository, before merging a change, see which repositories pin what it touches:

```
ctxlock impact --base origin/main --locks ../checkouts
```

`--locks` reads every `ctxlock.lock` under the folders you give, and lists the repositories that pin a changed unit, by their `origin` URL or their folder ([commands](commands.md#ctxlock-impact)). It reads checkouts on your disk. It doesn't fetch locks from GitHub.

## Keeping one pull request open

[`templates/ctxlock-sync.yml`](../templates/ctxlock-sync.yml) is a workflow to copy into `.github/workflows/` of each repository that syncs. Once a week, or when you run it by hand, it:
1. builds ctxlock and runs `ctxlock sync --format markdown`;
2. if anything changed, commits it to the branch `ctxlock/sync` and opens one pull request, or updates the open one, with sync's report as its body;
3. on a refusal or an error, fails the job, with the report in the job summary.

**Things to know:**
- **The repository pulls; nothing pushes into it.** The workflow uses the repository's own `GITHUB_TOKEN`, with `contents: write` and `pull-requests: write`. No credential with access to every repository exists anywhere.
- **A private org repository needs a token that can read it,** saved as the secret `CTXLOCK_UPSTREAM_TOKEN`. Only the sync step's git sees it.
- **GitHub doesn't run other workflows on a pull request made with `GITHUB_TOKEN`.** That includes the ctxlock check, so sync's report in the pull request body is all a reviewer sees by default. To have checks run, make a GitHub App token with [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) and give it to `actions/checkout` and as `GH_TOKEN`, in place of `github.token`.
- **A run pushes only when there is something new.** If the open pull request already has the same files, the run leaves it alone, so its approvals stay. With no open pull request, because someone closed it or GitHub refused it, the next run opens one again.
- **Pin the ctxlock it builds.** `CTXLOCK_REF` is `main` in the template. The job can push to your repository, so set it to a ctxlock commit you have read.
- **The repository has to allow it:** under *Settings → Actions → General*, "Allow GitHub Actions to create and approve pull requests" must be on. A new repository has it off. Then the run pushes `ctxlock/sync` and fails with "GitHub Actions is not permitted to create or approve pull requests". Turn it on, or run `gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow -F can_approve_pull_request_reviews=true`, and the next run opens the pull request.

## Sharing what was loaded

To tell the org repository's owners which of their units your sessions actually load, send them [`ctxlock report`](collector.md#sharing-what-was-loaded). It holds counts per unit, and nothing local. Nothing reads these reports on the org's side yet.
