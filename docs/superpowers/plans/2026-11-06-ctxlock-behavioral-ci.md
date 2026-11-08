# ctxlock Behavioral Context CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ctxlock eval` and `ctxlock probe draft`, plus a behavioral section in the GitHub Action. On a pull request that changes agent context, they run small probes against Claude Code with the base and the head context, and report whether the agent's behaviour changed, whether it loaded the change, and what the check cost. Nothing the agent tries to do is executed.

**Architecture:**
- Each arm, base or head, is copied out of git into a throwaway folder outside the repository. Execution-affecting config is stripped from the copy.
- A driver runs `claude -p` in that folder with run-scoped hooks. The hooks record what loaded and what the agent tried, deny every action, and keep reads inside the folder.
- Probes are YAML files in `evals/probes/`. Each one names a unit, a prompt and a deterministic expectation, and is graded from the transcript.
- `runEval` selects the probes whose unit changed, runs both arms within a budget of runs and minutes, caches results by git tree, and classifies each probe. Renderers turn that into text, JSON or a PR comment section.

**Tech Stack:** as in Plan 1: TypeScript 7 on Node ≥ 22 (ESM), commander, yaml, zod, picomatch, vitest. **No new runtime dependency.** Claude Code is an external program found on `PATH`, verified at 2.1.292. The Action adds `actions/cache@v4` and installs `@anthropic-ai/claude-code` from npm at a pinned version.

**Spec:** [docs/superpowers/specs/2026-11-05-ctxlock-design.md](../specs/2026-11-05-ctxlock-design.md): §5.2 (eval design rules), §6 Phase 1 and §7 (security). The spikes settled what the spec left to the builder:
- [S1](../../spikes/S1-eval-runner.md): the runner, its flags and isolation, and CI auth.
- [S3](../../spikes/S3-reproduction.md): which probes work, and their usage.
- [S4](../../spikes/S4-telemetry.md): the load join, and the `AGENTS.md` gap.

The decisions they led to are D35–D37 in [journey/decisions.md](../../../journey/decisions.md).

**Progress** (kept current as tasks land):

| Task | Status | Commits |
|---|---|---|
| 1 | Done | `5914d50` |
| 2 | Done | `275f2dd` |
| 3 | Done | `1221634` |
| 4 | Done | `f138ccb` |
| 5 | Done | `8ae5098` |
| 6 | Done | `6ceddfc` |
| 7 | Done | `0d64289` |
| 8 | Done; run live on [PR #1](https://github.com/SatyamSingh-Git/ctxlock/pull/1), without credentials | `c626853` |
| 9 | Done: isolation, and exit items (a) and (b), live in 73 runs ([report](../../dogfood/2026-11-06-behavioral.md)); one bug fixed | `f6f7376` and the docs commit |
| Final review | Done: 3 critical and 4 important findings fixed, each with a test that failed first; the inline-shell fix checked live in 5 more runs ([chapter 9](../../../journey/09-behavioral-ci.md#the-final-review)) | the fix-pass commit |

**Deferred from the final review** (minor; fixed afterwards where marked):
- `M1` (fixed): a brace glob such as `{..,x}/*` passed the hook's `climbs` check. Each alternative is now checked.
- `M2` (fixed): frontmatter ctxlock cannot parse was dropped only for an unquoted `hooks:` or `allowed-tools:` line, and YAML merge keys were not handled.
- `M3` (fixed): the error when a run changes the copy listed file names, which were written behind the hooks, and could reach the pull request comment. It now gives the count.
- `M4` (fixed): the cache key lacked ctxlock's own version, the default `<tmpdir>/ctxlock-cache` was shared between users on one Linux machine, and a torn cache file stopped the check with exit 2. The key now includes the version, the default is the user's cache folder, and a torn file is a miss.
- `M5` (fixed): `probe draft` did not check drafted ids against existing probes, and printed the model's ids and reasons as they were. Taken ids are now discarded, and control characters in the printout are replaced.
- `M6` (fixed): a working-tree head arm included the gitignored `CLAUDE.local.md`, which the base arm never has; so did `probe draft`'s arms.
- `M7` (re-graded important, not fixed): on macOS the temp folder is behind a `/var` → `/private/var` symlink, so the hook may deny every read and loads may not join. It fails closed; the fix needs a Mac to check it on.
- `M8` (fixed): an `InstructionsLoaded` event without `file_path`, or a torn log line, threw; `readAll` left `git cat-file` blocked, and ctxlock unable to exit, if its callback threw; a `claudeVersion` time-out did not say so.
- `M9` (fixed): with 4 or more runs, a probe the time budget cut short could be inconclusive yet gated, and fully cached probes after a time cut were reported as not run.
- `M10` (fixed): the test that no agent text reaches the output covered `renderEval` only. A CLI test now checks stdout and stderr in every format, with `--keep-runs`, and when a run stops the check.

As built, Task 2 sends the prompt on stdin, not as an argument (D45, found live in Task 9). The cache lasts for one pull request in the Action, not across pull requests (Task 8). Windows users with an npm install pass the package's `bin/claude.exe` to `--claude`; there is no `cli.js` (Task 8).

**Scope:**
- **In this plan:**
  - From the spec: probes (§5.2 item 1) and "units loaded per arm" (item 2).
  - Cost, steps and tokens (item 3).
  - `ctxlock eval --base --head` with arms, repeats, a base cache and the budget cap.
  - The Claude Code collector inside each run.
  - The behavioral section of the Action.
  - The Phase 1 exit items (a) and (b), checked on three public repositories.
- **Moved to later plans,** each a ruling to record in the ledger at setup:
  - **`ctxlock build` and `--fill-missing` (Plan 3).** Plan 1's "After this plan" put it here. It is a separate subsystem (rulesync, writing files into the repository) that shares nothing with evals, and the writing-plans scope rule says one plan per subsystem. *Cost if wrong:* `build` lands one plan later.
  - **Golden tasks and `ctxlock eval init` (a later plan).** Golden tasks must *execute* commands under an allowlist, which is a larger safety surface than observe-and-deny. No exit criterion needs them, and the spec makes them advisory only. *Cost if wrong:* repositories with golden suites get probes only.
  - **A Codex collector.** Spec §6 Phase 1: "Codex gets static prediction, lint and budgets. Its runtime evals wait for a contributor with Codex access." The driver sits behind a `harness` field so one can be added. *Cost if wrong:* none until someone has Codex access.
  - **L12, the LLM contradiction check.** Plan 1 moved it "to the next plan". It would reuse this plan's driver and adds nothing to the exit criteria. *Cost if wrong:* L12 waits one more plan.
  - **The optional `none` arm and the length-matched control** (spec §5.2, "Arms"). They measure whether context helps at all, which is the scheduled benchmark's question, not a PR check's. `probe draft`'s without-arm (Task 7) covers the one place this plan needs it. *Cost if wrong:* `eval` cannot answer "does this file help at all?" yet.
  - **Fork pull requests.** The spec says a maintainer label should let a fork's PR run evals. On `pull_request`, forks get no secrets, label or not, and `pull_request_target` would run the fork's context with the repository's secrets. Forks get a "skipped" line instead. *Cost if wrong:* fork PRs get static checks only.

## Global Constraints

- **Inherited from Plan 1, unchanged:**
  - names (`ctxlock`, `ctxlock.yaml`, `.ctxlock/`);
  - Apache-2.0, with runtime dependencies MIT, Apache-2.0, ISC or BSD only;
  - Node ≥ 22 ESM, and `"private": true`;
  - repo-relative POSIX paths everywhere;
  - CI on ubuntu-latest and windows-latest;
  - work on `main` unless Satyam asks for a branch;
  - every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - read `~/.claude/code-style.md` before writing code;
  - every test is seen failing first and is mutation-checked;
  - `npm run ci` before the final push;
  - invisible characters only via `String.fromCodePoint`;
  - harness limits as data.
- **Exit codes:** `0` clean; `1` only for `diff`'s must findings, or `eval --fail-on-regression` with a gated regression; `2` usage, config or "could not run". **Behavioral results are advisory by default** (spec §9: "Advisory by default").
- **Nothing the agent intends runs.** The run-scoped `PreToolUse` hook denies `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit` (S1). It also denies `Read|Glob|Grep` outside the run folder. The tool allowlist is exactly `Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill`.
- **The Claude Code flags are S1's, exactly:**
  ```
  -p <prompt> --output-format stream-json --verbose --settings <file> --setting-sources project --strict-mcp-config --tools <list> --no-session-persistence --model <model>
  ```
  Never `--bare`: it drops `--settings` hooks and ignores `CLAUDE_CODE_OAUTH_TOKEN`.
- **The environment for every run** adds `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (present in the 2.1.292 binary), so the only traffic is to the model API.
- **No execution config reaches a run.** Copies never contain:
  - `.claude/settings.json` or `.claude/settings.local.json` at any depth;
  - `.mcp.json`;
  - a `hooks` key in the frontmatter of any `.md` file under a `.claude/` folder.

  Each removal is listed in the result.
- **No agent-produced text in any output.** Text, JSON and markdown carry counts, statuses, unit IDs, digests and probe definitions only. Intended commands, edits and replies stay in the run folder, which is deleted unless `--keep-runs`. In a public repository, a PR comment or CI log that quoted what the agent tried would be a channel out for anything it read.
- **Nothing is written into the scanned repository,** except the one new file that `ctxlock probe draft` writes under `evals/probes/`. Run folders and the cache live in `--workdir`: by default `$RUNNER_TEMP` in Actions, otherwise `os.tmpdir()`.
- **Run folders must have no instructions above them** (S1's `~/.claude/CLAUDE.md` leak):
  - The settings file sets `claudeMdExcludes` for every ancestor's `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules/**`. That key exists in 2.1.292: picomatch over absolute paths, for User, Project and Local files.
  - `ctxlock eval` refuses to run when an ancestor holds what that setting cannot exclude: `AGENTS.md`, `.claude/AGENTS.md`, or `.claude/skills/` other than the home folder's own `~/.claude/skills`, which S1 showed is not loaded under `--setting-sources project`.
- **Tests never call the real Claude Code.** CI has no credentials. Every test uses `tests/helpers/fake-claude.mjs`, which runs the real hook commands from the settings file the way Claude Code does. Live runs happen only in Task 9.
- **Live run budget:** at most **200** headless runs in all, on `--model sonnet`. Before each batch, read `rate_limit_event.unifiedWindows.seven_day.utilization`, and stop when it is 0.05 above its value before the first live run, or at 0.90 or more.
- **Windows:** ctxlock spawns `claude` without a shell. The native installer's `claude.exe` works. An npm install's `claude.cmd` does not; pass `--claude <path to cli.js>` instead. Never use `shell: true`, because the prompt comes from repository files. Document this in the guide.

## Review Focus

1. **A hostile pull request's context, during an eval.** Project hooks, skill-frontmatter hooks, `allowed-tools: Bash`, a `Read` of `../../.ssh/id_rsa`, a Glob of `/etc/**`, or an `@/abs/path` import. A person expects that nothing runs, nothing outside the copy is read, and no agent text reaches the PR. Pinned by:
   - Task 1: the stripping tests;
   - Task 2: the hook confinement tests;
   - Task 6: a canary command that must not appear in any rendering;
   - Task 9: live checks of the parts that only Claude Code itself can prove.
2. **Claude Code missing, logged out, rate-limited or hung.** A person expects a clear reason and exit 2, never a hang or a fake pass. Pinned by Task 2's failure tests and Task 5's inconclusive test.
3. **Copies that differ from git.** CRLF blobs, binary files, symlinks to directories, or links out of the repository. A person expects the agent to see exactly what git holds, and the load join's digests to match the scan. Pinned by Task 1's byte-for-byte test.
4. **Broken probe files.** A bad regex, a duplicate ID, an unknown unit, or two expectations in one probe. A person expects exit 2 naming the file and the probe, before any run is spent. Pinned by Task 3 and Task 5.
5. **More probes than the budget allows,** or a check that runs past its minutes. A person expects the probes that did not run to be listed with the reason, never silently dropped. Pinned by Task 5's budget and minutes tests.

## Files

| File | Responsibility |
|---|---|
| `src/repo/reader.ts` (modify) | `readAll` on every reader; `gitReader` streams blobs through one `git cat-file --batch` |
| `src/eval/workspace.ts` | Copy an arm out of git, strip execution config, tripwire snapshot, ancestor checks |
| `src/eval/hook-script.ts` | The run-scoped hook, as JavaScript source written next to each run's settings |
| `src/eval/claude.ts` | Build the settings and flags, spawn `claude`, parse `stream-json` and the hook log into a `Transcript` |
| `src/eval/probes.ts` | Probe file schema, loading, grading |
| `src/eval/loads.ts` | Join observed loads to units (spec §4.3 `context.load`), plus predicted `AGENTS.md` fallback loads (D37) |
| `src/eval/eval.ts` | Selection, budget, arms, cache, status, gate |
| `src/eval/draft.ts` | Draft probes with Claude, validate them against with and without arms, write the file |
| `src/report/eval.ts` | Text, JSON and markdown for an `EvalResult` |
| `src/registry/registry.ts` (modify) | `eval:` settings in `ctxlock.yaml` |
| `src/cli.ts` (modify) | `ctxlock eval`, `ctxlock probe draft` |
| `action.yml` (modify) | Install Claude Code, run the behavioral check, cache, result rules |
| `tests/helpers/fake-claude.mjs` | A stand-in for `claude` that runs the real hooks from `--settings` |
| `tests/fixtures/eval/stream-pnpm.jsonl` | A recorded Claude Code 2.1.292 stream from S1, with local paths replaced |

---

### Task 1: Copy an arm for a run

**Files:**
- Modify: `src/repo/reader.ts` and `tests/helpers/mem-reader.ts`: add `readAll`.
- Create: `src/eval/workspace.ts`.
- Test: `tests/repo/reader.test.ts` (add), `tests/eval/workspace.test.ts`.

**Interfaces:**
- **Consumes:** `RepoReader` (`listFiles`, `readFile`, `listSymlinks`) and `splitFrontmatter` from `src/units/frontmatter.ts`.
- **Produces:**
  - `RepoReader.readAll(onFile: (path: string, bytes: Buffer) => void | Promise<void>): Promise<void>`. It is called once per listed file, in `listFiles()` order.
  - `materialize(reader: RepoReader, dir: string): Promise<Materialized>`, with `interface Materialized { files: number; stripped: string[]; droppedLinks: string[] }`. `stripped` is sorted. A file entry is its path; a frontmatter removal is `<path> (hooks)`.
  - `type Snapshot = Map<string, string>`, `snapshot(dir: string): Snapshot` and `changedSince(dir: string, before: Snapshot): string[]`.
  - `ancestorContext(dir: string, home?: string): string[]`, returning absolute POSIX paths, sorted.
  - `ancestorExcludes(dir: string): string[]`.

- [ ] **Step 1: Write the failing reader test** in `tests/repo/reader.test.ts`:

```ts
it('readAll yields every listed file byte for byte, CRLF and binary included, from a ref and the working tree', async () => {
  const bin = Buffer.from([0, 255, 13, 10, 0]);
  const { dir, shas } = await gitRepo([{ 'a.md': 'x\r\ny\r\n', 'b.bin': bin, 'c/d.md': 'd' }]);
  for (const reader of [await gitReader(dir, shas[0]!), fsReader(dir)]) {
    const seen = new Map<string, Buffer>();
    await reader.readAll((path, bytes) => void seen.set(path, bytes));
    expect([...seen.keys()]).toEqual(await reader.listFiles());
    expect(seen.get('a.md')!.toString('utf8')).toBe('x\r\ny\r\n');
    expect(seen.get('b.bin')!.equals(bin)).toBe(true);
  }
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npx vitest run tests/repo/reader.test.ts -t readAll`. Expected: FAIL, `reader.readAll is not a function`.

- [ ] **Step 3: Implement `readAll`.**
  - `gitReader` keeps each file's object id from `ls-tree`, writes the ids to one `git cat-file --batch` child, and parses `<oid> blob <size>\n<bytes>\n` from its stdout.
  - The working-tree reader and `walk` loop over `readFile`.
  - `memReader` loops over its files.

- [ ] **Step 4: Run it and watch it pass,** then run the whole suite. Run `npx vitest run`. Expected: all pass.

- [ ] **Step 5: Write the failing workspace tests** in `tests/eval/workspace.test.ts`. Symlinks are committed with `gitSymlink` and read through `gitReader`, so the test runs on Windows without developer mode.

```ts
it('copies every file and replaces in-repo links with their target, dropping links that leave the repo', async () => {
  const { dir } = await gitRepo([{ 'AGENTS.md': 'Use pnpm.\n', '.agents/skills/r/SKILL.md': '---\nname: r\ndescription: d\n---\nbody\n' }]);
  gitSymlink(dir, 'CLAUDE.md', 'AGENTS.md');
  gitSymlink(dir, '.claude/skills', '../.agents/skills');
  const sha = gitSymlink(dir, 'x.md', '../../outside.md');
  const out = join(tempDir(), 'arm');
  const result = await materialize(await gitReader(dir, sha), out);
  expect(readFileSync(join(out, 'CLAUDE.md'), 'utf8')).toBe('Use pnpm.\n');
  expect(readFileSync(join(out, '.claude/skills/r/SKILL.md'), 'utf8')).toContain('name: r');
  expect(lstatSync(join(out, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
  expect(existsSync(join(out, 'x.md'))).toBe(false);
  expect(result.droppedLinks).toEqual(['x.md']);
  expect(existsSync(join(out, '.git'))).toBe(true);
});

it('strips execution config: project settings at any depth, .mcp.json, and hooks in .claude markdown frontmatter', async () => {
  const skill = '---\nname: r\ndescription: d\nallowed-tools: Bash\nhooks:\n  PreToolUse:\n    - hooks: [{ type: command, command: touch pwned }]\n---\nbody\n';
  const { dir, shas } = await gitRepo([{
    '.claude/settings.json': '{"hooks":{}}', 'pkg/.claude/settings.local.json': '{}', '.mcp.json': '{}',
    '.claude/skills/r/SKILL.md': skill, 'docs/hooks.md': '---\nhooks: kept\n---\nnot under .claude\n',
  }]);
  const out = join(tempDir(), 'arm');
  const result = await materialize(await gitReader(dir, shas[0]!), out);
  expect(result.stripped).toEqual(['.claude/settings.json', '.claude/skills/r/SKILL.md (hooks)', '.mcp.json', 'pkg/.claude/settings.local.json']);
  const copied = readFileSync(join(out, '.claude/skills/r/SKILL.md'), 'utf8');
  expect(splitFrontmatter(copied).frontmatter).toEqual({ name: 'r', description: 'd', 'allowed-tools': 'Bash' });
  expect(copied.endsWith('---\nbody\n')).toBe(true);
  expect(readFileSync(join(out, 'docs/hooks.md'), 'utf8')).toContain('hooks: kept');
  for (const gone of ['.claude/settings.json', 'pkg/.claude/settings.local.json', '.mcp.json']) expect(existsSync(join(out, gone))).toBe(false);
});
```

  Add three more tests:
  - **`changedSince` reports a file written or changed after `snapshot`, and nothing otherwise.** Check both directions. `.git/` is ignored.
  - **`ancestorContext`.** Build `<t>/AGENTS.md`, `<t>/.claude/skills/s/SKILL.md`, `<t>/home/.claude/skills/u/SKILL.md` and the run folder `<t>/home/runs/arm`. Then `ancestorContext('<t>/home/runs/arm', '<t>/home')`, filtered to paths under `<t>`, equals `['<t>/.claude/skills', '<t>/AGENTS.md']` (POSIX). With `<t>/AGENTS.md` deleted, it equals `['<t>/.claude/skills']`.
  - **`ancestorExcludes` is pure on strings.** `ancestorExcludes('/a/b/run')` equals:
    ```
    ['/a/b/CLAUDE.md', '/a/b/.claude/CLAUDE.md', '/a/b/CLAUDE.local.md', '/a/b/.claude/rules/**',
     '/a/CLAUDE.md', '/a/.claude/CLAUDE.md', '/a/CLAUDE.local.md', '/a/.claude/rules/**',
     '/CLAUDE.md', '/.claude/CLAUDE.md', '/CLAUDE.local.md', '/.claude/rules/**']
    ```
    `ancestorExcludes('C:\\x (1)\\run')[0]` is `'C:/x \\(1\\)/CLAUDE.md'`: backslashes become `/`, and glob characters in the folder names are escaped.

- [ ] **Step 6: Run them and watch them fail.** Run `npx vitest run tests/eval/workspace.test.ts`. Expected: FAIL, cannot find module `src/eval/workspace.js`.

- [ ] **Step 7: Implement `src/eval/workspace.ts`.**
  - **`materialize`** creates `dir` and writes files through `readAll`.
  - **A link** to a file is written with the target's bytes. A link to a folder gets every listed file under the target's prefix. A `null` target, or a target that is itself a link, is dropped.
  - **Stripping** happens after the copy. Paths matching `/(^|\/)\.claude\/settings(\.local)?\.json$/` or exactly `.mcp.json` are deleted.
  - **Frontmatter.** For a `.md` file under a `.claude/` folder whose `splitFrontmatter` frontmatter has a top-level `hooks` key, the file is rewritten as `---\n${stringify(rest)}---\n${body}`. If the frontmatter does not parse and its text has a line matching `/^hooks\s*:/m`, the frontmatter is removed entirely; that is still recorded as `(hooks)`.
  - **Finally**, `git init -q` runs in `dir`, as S1 did.
  - **`snapshot`** maps each path except `.git/**` to `${size}:${mtimeMs}`.
  - **`ancestorContext`** walks from `dirname(dir)` to the filesystem root.

- [ ] **Step 8: Run them and watch them pass.** Run `npx vitest run tests/eval/workspace.test.ts tests/repo/reader.test.ts`. Expected: PASS. Then mutation-check: each of the following must fail a test.
  - Drop the `.mcp.json` rule.
  - Keep `hooks`.
  - Write link text instead of the target.
  - Stop escaping `(`.
  - Skip the home exception.

- [ ] **Step 9: Commit.**

```bash
git add src/repo/reader.ts src/eval/workspace.ts tests/helpers/mem-reader.ts tests/repo/reader.test.ts tests/eval/workspace.test.ts
git commit -m "feat: copy an arm out of git for an agent run, without its execution config"
```

---

### Task 2: The Claude Code driver

**Files:**
- Create: `src/eval/hook-script.ts`, `src/eval/claude.ts`, `tests/helpers/fake-claude.mjs` and `tests/fixtures/eval/stream-pnpm.jsonl`.
- Test: `tests/eval/hook.test.ts` and `tests/eval/claude.test.ts`.

**Interfaces:**
- **Consumes:** `ancestorExcludes` (Task 1).
- **Produces:**
  - `PROBE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell', 'Edit', 'Write', 'Skill']`.
  - `HOOK_SCRIPT: string`.
  - `claudeArgs(opts: { prompt: string; model: string; tools: string[] }, settingsPath: string): string[]`.
  - `claudeSettings(hook: (event: string) => string, excludes: string[]): Record<string, unknown>`.
  - `parseStream(text: string, dir: string): StreamFacts`.
  - `relativeTo(root: string, file: string): string | null`.
  - `runClaude(run: ClaudeRun): Promise<Transcript>`.
  - `claudeVersion(claude: string[]): Promise<string>`.
  - `class ClaudeNotFound extends Error`.

```ts
export interface ClaudeRun { dir: string; scratch: string; prompt: string; model: string; claude: string[]; tools?: string[]; timeoutMs?: number }
export interface ObservedLoad { path: string; reason: string; parent?: string; trigger?: string } // repo-relative POSIX
export interface Transcript {
  model: string | null; version: string | null;
  turns: number; durationMs: number; wallMs: number;
  inputTokens: number;   // input + cache read + cache creation
  outputTokens: number; costUsd: number; utilization: number | null;
  commands: string[]; edits: string[]; skills: string[]; listedSkills: string[];
  loads: ObservedLoad[]; denied: number; outsideReads: number;
  text: string;          // the final reply; used by probe drafting, never rendered
  error: string | null;
}
type StreamFacts = Omit<Transcript, 'loads' | 'denied' | 'outsideReads' | 'wallMs' | 'error'> & { error: string | null };
```

- [ ] **Step 1: Record the fixture.**
  - Copy `.superpowers/s1-runs/promptfoo-GXsqf4/stream.jsonl` to `tests/fixtures/eval/stream-pnpm.jsonl`.
  - Replace every absolute path with `/run`, and delete `memory_paths`, `scratchpad_path` and `messaging_socket_path`.
  - Check it with `grep -c -i 'satyam\|F:\\\\' tests/fixtures/eval/stream-pnpm.jsonl`. Expected: `0`.

- [ ] **Step 2: Write `tests/helpers/fake-claude.mjs`.** It reads `FAKE_CLAUDE_SCENARIO`, a path to JSON:

```json
{ "version": "2.1.292", "model": "claude-sonnet-5-5", "skills": ["release", "simplify"],
  "loads": [{ "file": "CLAUDE.md", "reason": "session_start" }, { "file": "AGENTS.md", "reason": "include", "parent": "CLAUDE.md" }],
  "behaviours": [{ "when": { "file": "AGENTS.md", "contains": "pnpm" }, "calls": [{ "tool": "Bash", "input": { "command": "pnpm add zod" } }] },
                 { "calls": [{ "tool": "Bash", "input": { "command": "npm install zod" } }] }],
  "text": "done", "exit": 0, "stderr": "", "sleepMs": 0, "apiErrorStatus": null, "touch": null }
```

  What the fake does, the way Claude Code does it:
  - **`--version`** prints `<version> (Claude Code)`.
  - **Arguments.** When `FAKE_CLAUDE_ARGV_LOG` is set, it appends `{ argv, cwd, nonessential, apiKey, oauthToken }` to it as a JSON line. The last three say whether `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` are defined.
  - **Settings.** It reads `--settings`.
  - **Loads.** It emits `InstructionsLoaded` for each load whose file exists in the cwd, with an absolute `file_path`.
  - **Behaviours.** It picks the first behaviour whose `when` matches, either `file`/`contains` in the cwd or `promptContains`.
  - **Calls.** For each call, it runs the hook commands of every `PreToolUse` matcher that matches the tool name, through `spawnSync(command, { shell: true, input })`, with a payload that has `cwd`, `tool_name` and `tool_input`. A `deny` decision becomes an error `tool_result`. An allowed `Write` writes its `file_path`, and an allowed `Skill` runs the `PostToolUse` Skill hooks.
  - **Output.** It emits init, assistant `tool_use`, user `tool_result`, `rate_limit_event` (utilization `0.57`) and `result` messages. `usage.input_tokens` is 1000 plus the bytes of the loaded files.
  - **Scenario fields:**
    - `touch` writes a file into the cwd with no hook at all.
    - `sleepMs` delays before the result.
    - `exit` and `stderr` end the process.
    - `apiErrorStatus` makes the result `is_error: true`, `subtype: "error_during_execution"`.

- [ ] **Step 3: Write the failing hook tests** in `tests/eval/hook.test.ts`. Each one writes `HOOK_SCRIPT` to a temp `hook.mjs` and runs `process.execPath hook.mjs <event> <log> <root>` with the payload on stdin.
  - Each of `Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit`:
    - prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}`;
    - the reason starts with `observe-and-deny`;
    - one line is appended to the log.
  - **Allowed, with no output and no log line:** a `Read` of `<root>/src/a.ts`; a `Grep` with no `path`, whose `cwd` is `<root>`; a `Glob` with pattern `**/*.ts`.
  - **Denied, with a reason containing `outside the run folder`:** a `Read` of `<root>/../secret.txt`; a `Read` of another absolute folder; a `Glob` with pattern `/etc/**`; a `Glob` with pattern `../*`; a `Grep` with `path: '..'`.
  - On win32, a `Read` of `<ROOT uppercased>/a.ts` is allowed.
  - `InstructionsLoaded` and `PostToolUse` append their payload and print nothing.

- [ ] **Step 4: Write the failing driver tests** in `tests/eval/claude.test.ts`:

```ts
it('passes the isolation flags from spike S1, exactly', () => {
  expect(claudeArgs({ prompt: 'p', model: 'sonnet', tools: PROBE_TOOLS }, '/s/settings.json')).toEqual([
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--settings', '/s/settings.json',
    '--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill',
    '--no-session-persistence', '--model', 'sonnet',
  ]);
  expect(claudeArgs({ prompt: 'p', model: 'sonnet', tools: [] }, 's').slice(10, 12)).toEqual(['--tools', '']);
});

it('reads a recorded Claude Code 2.1.292 stream', () => {
  const facts = parseStream(readFileSync('tests/fixtures/eval/stream-pnpm.jsonl', 'utf8'), '/run');
  expect(facts).toMatchObject({ model: 'claude-sonnet-5-5', version: '2.1.292', turns: 2, commands: ['pnpm add lodash'],
    inputTokens: 4 + 7084 + 60931, outputTokens: 255, costUsd: 0.0440392, utilization: 0.57, error: null });
  expect(facts.listedSkills).toContain('simplify');
});
```

  Add the following driver tests, each running `runClaude` through the fake:
  - **`claudeSettings`.** The `PreToolUse` matcher is `'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Read|Glob|Grep'`, the `PostToolUse` matcher is `'Skill'`, `InstructionsLoaded` has no matcher, and `claudeMdExcludes` equals the given list.
  - **Every intended action is denied and the copy is unchanged.**
    - The behaviour calls `Bash pnpm add zod` and `Write x.txt`.
    - Expected: `commands` is `['pnpm add zod']`, `edits` is `['x.txt']`, `denied` is `2` and `x.txt` does not exist.
    - `loads`, sorted, is `[{ path: 'AGENTS.md', reason: 'include', parent: 'CLAUDE.md' }, { path: 'CLAUDE.md', reason: 'session_start' }]`.
  - **A `Read` outside the copy** gives `outsideReads: 1`.
  - **Failures become `error`, never a throw:**
    - exit 1 with stderr `Invalid API key · Please run /login` gives `'claude exited 1: Invalid API key · Please run /login'`. Only the first stderr line is kept, cut to 200 characters.
    - `apiErrorStatus: 401` gives `'error_during_execution (API status 401)'`.
    - `sleepMs: 5000` with `timeoutMs: 500` gives `'timed out after 500 ms'`.
  - **`runClaude` with `claude: ['ctxlock-no-such-claude']`** rejects with `ClaudeNotFound`, whose message names `--claude`.
  - **`claudeVersion`** returns `'2.1.292'`.
  - **The fake receives `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.** The argv log's `nonessential` is `true`.
  - **`relativeTo`:**
    - `relativeTo('F:\\r\\run-1', 'f:\\R\\run-1\\packages\\api\\CLAUDE.md')` is `'packages/api/CLAUDE.md'`;
    - `relativeTo('/tmp/run', '/tmp/run/a.md')` is `'a.md'`;
    - `relativeTo('/tmp/run', '/tmp/other/a.md')` is `null`;
    - all three pass on every OS.

- [ ] **Step 5: Run them and watch them fail.** Run `npx vitest run tests/eval/hook.test.ts tests/eval/claude.test.ts`. Expected: FAIL on missing modules.

- [ ] **Step 6: Implement.**
  - **`HOOK_SCRIPT`** is plain ESM using only `node:fs` and `node:path`, about 40 lines.
  - **`runClaude`:**
    - writes `hook.mjs`, `settings.json` and `events.jsonl` into `scratch`;
    - builds the hook command as `"<execPath>" "<scratch>/hook.mjs" <Event> "<scratch>/events.jsonl" "<dir>"`, with every path in `/` form;
    - spawns `claude[0]` with `[...claude.slice(1), ...claudeArgs(...)]` in `cwd: dir`, using `encoding: 'utf8'`, `timeout: timeoutMs ?? 300_000` and `maxBuffer: 64 MiB`;
    - parses the stream, then folds in the hook log: loads relativised by `relativeTo`, deny count and outside reads.
  - **Errors.** `ENOENT` from spawn throws `ClaudeNotFound('Claude Code not found: install it, or pass --claude <path>')`.
  - **Scripts.** A `claude[0]` ending in `.js`, `.mjs` or `.cjs` is run with `process.execPath` (this is how `--claude` works in Task 6).

- [ ] **Step 7: Run them and watch them pass,** then run the suite. Run `npx vitest run`. Expected: all pass. Mutation-check: each of these must fail a test.
  - Drop `Write` from the matcher.
  - Drop `--strict-mcp-config`.
  - Allow `..` in Glob.
  - Count cache tokens out of `inputTokens`.
  - Swallow the timeout.

- [ ] **Step 8: Commit.**

```bash
git add src/eval/hook-script.ts src/eval/claude.ts tests/helpers/fake-claude.mjs tests/fixtures/eval tests/eval/hook.test.ts tests/eval/claude.test.ts
git commit -m "feat: run Claude Code headless with run-scoped observe-and-deny hooks"
```

---

### Task 3: Probe files

**Files:**
- Create: `src/eval/probes.ts`.
- Test: `tests/eval/probes.test.ts`.

**Interfaces:**
- **Consumes:** `RepoReader` and `Transcript` (Task 2).
- **Produces:**

```ts
export type Expectation = { command: string } | { edit: string } | { skill: string };
export interface Probe { id: string; file: string; unit: string; prompt: string; expect: Expectation; not: boolean; kind: 'adherence' | 'trigger'; hash: string }
export class ProbeError extends Error {}
export async function loadProbes(reader: RepoReader): Promise<Probe[]>
export function grade(probe: Probe, t: Transcript): boolean
```

The file format. `kind` is `trigger` for a `skill` expectation and `adherence` otherwise. `hash` is the sha256 of `JSON.stringify([id, unit, prompt, expect, not])`. Patterns are JavaScript regular expressions with no flags.

```yaml
version: 1
probes:
  - id: deps-use-pnpm
    unit: instructions/AGENTS.md
    prompt: Add zod as a dependency.
    expect:
      command: '\bpnpm\s+add\b'
  - id: release-quiet
    unit: skill/.claude/skills/release
    prompt: What does packages/api/handler.ts export?
    expect:
      skill: release
      not: true
```

- [ ] **Step 1: Write the failing tests.**
  - **Loading.** Every `evals/probes/**/*.yaml` or `.yml` file is read, in path order, and nothing outside `evals/probes/`. `kind` is derived. `hash` is stable across files and changes when `prompt` changes.
  - **A missing `evals/probes/`** gives `[]`.
  - **Errors** throw `ProbeError`, with messages matching:
    - `/^evals\/probes\/a\.yaml: probe x: invalid regular expression/` for `command: '(('`;
    - `/duplicate probe id x \(evals\/probes\/a\.yaml, evals\/probes\/b\.yaml\)/`;
    - `/probe x: expect needs exactly one of command, edit, skill/` for two keys;
    - `/unknown key/` for `promt:`;
    - `/version/` for `version: 2`.
  - **`grade`, both directions for each expectation:**
    - `command` matches any of `t.commands`;
    - `edit` matches any of `t.edits`;
    - `skill` is in `t.skills`;
    - `not: true` inverts each.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/eval/probes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it** with zod `strictObject` and `yaml` `parse(…, { schema: 'core' })`, in the style of `src/registry/registry.ts`. Patterns are compiled at load time.

- [ ] **Step 4: Run them and watch them pass,** then mutation-check: compile patterns lazily, drop the duplicate check, and ignore `not`. Each must fail a test.

- [ ] **Step 5: Commit.**

```bash
git add src/eval/probes.ts tests/eval/probes.test.ts
git commit -m "feat: probe files under evals/probes, graded from the transcript"
```

---

### Task 4: Join loads to units

**Files:**
- Create: `src/eval/loads.ts`.
- Test: `tests/eval/loads.test.ts`.

**Interfaces:**
- **Consumes:** `Transcript` (Task 2), `ScanResult` (`src/scan.ts`), `unitDigest` and `sha256Hex` (`src/units/digest.ts`), and the Claude Code root-site entries in `ScanResult.contexts`.
- **Produces:**

```ts
// Spec §4.3 context.load, without session and ts.
export interface LoadRecord {
  unit_id: string;
  unit_digest: string | null;   // null when the bytes loaded differ from the scanned unit
  load_reason: string;          // session_start | import | nested | glob | skill_listed | skill_invoked, or Claude Code's own value if new
  trigger_file?: string;
  observed: boolean;            // false: predicted, because Claude Code reports no event for it (D37)
}
export function joinLoads(t: Transcript, scan: ScanResult, dir: string): LoadRecord[]
```

- [ ] **Step 1: Write the failing tests.** Each builds a folder, scans it with `scanRepo(fsReader(dir))`, and passes a hand-made `Transcript`.
  - **Observed loads become records.**
    - Claude Code's reasons are mapped: `session_start` → `session_start`, `include` → `import`, `nested_traversal` → `nested`, `path_glob_match` → `glob`.
    - `trigger_file` comes from `trigger`.
    - Each digest equals the scanned unit's `digest`.
    - An unknown reason passes through unchanged.
  - **A loaded file whose bytes changed after the scan** has `unit_digest: null`.
  - **A load of a file that is no unit is ignored,** and so is a path outside `dir` (`relativeTo` gave `null`).
  - **Skills.**
    - `listedSkills: ['release', 'simplify']` gives one `skill_listed` record, for `skill/.claude/skills/release`. `simplify` is built in and has no unit.
    - `skills: ['release']` adds a `skill_invoked` record.
  - **D37, both directions.**
    - In a repository with only `AGENTS.md` and no loads, the result is `[{ unit_id: 'instructions/AGENTS.md', unit_digest: <digest>, load_reason: 'session_start', observed: false }]`.
    - With a `CLAUDE.md` that does not import it, the result has no `AGENTS.md` record.
    - A unit imported from a fallback-loaded `AGENTS.md` is predicted too, unless it was observed.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/eval/loads.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it.**
  - Paths are matched through each unit's `path` and `aliases`.
  - The digest is `unitDigest` over the file read from `dir`.
  - **Predictions** are the `always` entries of the `claude-code` context at site `''` that were not observed, where the entry's reason is `agents-md-fallback`, or `import:<p>` with `p` itself predicted.

- [ ] **Step 4: Run them and watch them pass,** then mutation-check: always set `observed: true`, skip the digest check, and predict for every unobserved entry. Each must fail a test.

- [ ] **Step 5: Commit.**

```bash
git add src/eval/loads.ts tests/eval/loads.test.ts
git commit -m "feat: join what Claude Code loaded to units, predicting the AGENTS.md fallback it never reports"
```

---

### Task 5: Run the arms

**Files:**
- Create: `src/eval/eval.ts`.
- Test: `tests/eval/eval.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `materialize`, `snapshot`, `changedSince` and `ancestorContext`;
  - from Task 2: `runClaude` and `claudeVersion`;
  - from Task 3: `loadProbes` and `grade`;
  - from Task 4: `joinLoads`;
  - from Plan 1: `scanRepo`, `diffScans(...).changes`, `gitReader`, `fsReader` and `gitTopLevel`.
- **Produces:**

```ts
export interface EvalOptions {
  root: string; base: string; head?: string;
  runs: number; maxRuns: number; maxMinutes: number; model: string;
  claude: string[]; workdir: string; cacheDir: string | null;
  all: boolean; keepRuns: boolean;
  now?: () => number;
}
export interface ArmResult {
  passed: number; valid: number; errors: string[]; cached: number;
  interval: [number, number] | null;   // 95% Wilson interval of passed/valid; null when valid is 0
  models: string[];                    // distinct models the runs reported, cached ones included
  inputTokens: number | null; turns: number | null; durationMs: number | null;   // medians over valid runs
  costUsd: number; targetLoaded: { observed: number; predicted: number };
}
export type ProbeStatus = 'improved' | 'regressed' | 'unchanged' | 'inconclusive' | 'not-run';
export interface ProbeOutcome { probe: Probe; source: 'base' | 'head'; changedInHead: boolean; base: ArmResult | null; head: ArmResult | null; status: ProbeStatus; reason?: string }
export interface EvalResult {
  harness: 'claude-code'; model: string | null; claudeVersion: string; runsPerArm: number;
  changedUnits: string[]; outcomes: ProbeOutcome[]; stripped: string[]; gateFailures: string[];
  totals: { runs: number; cachedRuns: number; wallMs: number; costUsd: number; utilizationBefore: number | null; utilizationAfter: number | null };
}
export class EvalError extends Error {}
export function status(base: ArmResult | null, head: ArmResult | null): ProbeStatus
export async function runEval(opts: EvalOptions): Promise<EvalResult>
```

**Rules this task pins:**
- **Selection.**
  - Probes are base ∪ head by `id`. When both define an `id`, the **base definition wins** and `changedInHead` is set: the same rule as D30, so a PR cannot rewrite the probe that judges it.
  - A probe runs when its `unit` is in `changedUnits` (the IDs in `diffScans(base, head).changes`), or when `all` is set.
  - A probe whose unit exists in neither scan throws `EvalError`.
- **Budget.** A probe costs `2 × runs` minus cached runs. Probes are taken in load order until the next one would pass `maxRuns`; the rest are `not-run`, with reason `run budget (<maxRuns> runs)`. Before each run, if more than `maxMinutes` have passed, no more runs start, and the probes left are `not-run` with reason `time budget (<maxMinutes> min)`, or `inconclusive` if they are part-run.
- **Order.** Runs alternate base and head for each run index, so drift in the model hits both arms alike. Runs are sequential.
- **Arms.**
  - `materialize` runs once per arm into `mkdtemp(<workdir>/ctxlock-run-)/{base,head}`. Each run's `scratch` is `<run root>/scratch/<n>`, a sibling of the arms, never inside one.
  - Before any run, `ancestorContext` is checked on each arm folder; anything found throws `EvalError("<path> is above the run folder and would load into every run; pass --workdir <a folder outside it>")`.
  - After each run, a non-empty `changedSince` throws `EvalError("a run changed files in the copy: <paths>")`.
  - The run root is deleted at the end unless `keepRuns`.
- **Status.**
  - `inconclusive` if either arm has fewer than 2 valid runs.
  - Otherwise, let `d = head.passed/head.valid − base.passed/base.valid`: `d ≥ 0.5` is `improved`, `d ≤ −0.5` is `regressed`, anything else is `unchanged`.
  - Errored runs count only in `errors`.
- **Gate** (`gateFailures`, used by `--fail-on-regression`). A probe fails it when:
  - its `source` is `base`;
  - both arms have at least 3 valid runs;
  - every base run passed, and no head run did.

  At 3 against 3 that is a one-sided Fisher p of 0.05, the strongest result 3 runs can give.
- **Cache.**
  - Only arms read from a git ref are cached: the base always, and the head when `--head` is a ref.
  - The key is `sha256(JSON.stringify([treeSha, probe.hash, opts.model, claudeVersion]))`, where `treeSha` is `git rev-parse <ref>^{tree}`. The probe outcome depends on non-context files too, such as `package.json`'s `packageManager`, so a hash of the units alone would be wrong (ruling).
  - The file is `<cacheDir>/<key>.json`, holding the run records. Up to `runs` cached records are reused, and new ones are appended.
  - An alias such as `sonnet` is keyed together with the Claude Code version. Each record keeps the model its run reported, and `ArmResult.models` lists them, so a cached base on another model shows in the report rather than hiding (ruling). *Cost if wrong:* an alias that moves server-side without a Claude Code release compares two models until the cache ages out, and the report says so.
- **Intervals.** `interval` is the 95% Wilson score interval (z = 1.96). For 3 of 3 it is `[0.4385, 1]`, and for 0 of 3 it is `[0, 0.5615]`, to 4 places.

- [ ] **Step 1: Write the failing tests.** A helper builds a git repo whose base commit has:
  - `AGENTS.md` saying `Use npm.`;
  - `evals/probes/p.yaml` with probe `deps` on `instructions/AGENTS.md`, expecting `\bpnpm\s+add\b`.

  The working tree changes `AGENTS.md` to `Use pnpm.` The fake's first behaviour is `when AGENTS.md contains pnpm`, giving `pnpm add zod`; the default gives `npm install zod`. Then:
  - **A changed instruction flips its adherence probe.** `outcomes[0]` has `status: 'improved'`, base `{ passed: 0, valid: 3 }` and head `{ passed: 3, valid: 3 }`. `changedUnits` is `['instructions/AGENTS.md']` and `totals.runs` is `6`. Both arms' `models` are `['claude-sonnet-5-5']`. The intervals, rounded to 4 places, are `[0, 0.5615]` and `[0.4385, 1]`.
  - **Reverting the change clears the flag.** With the working tree equal to the base, `outcomes` is `[]`. With `all: true`, the status is `unchanged`.
  - **The gate.** It fails only when every base run passed and no head run did, and the probe comes from the base. Build the regressed case, and the same case with the probe added only in the head: `source: 'head'`, and `gateFailures` is `[]`.
  - **A head definition of a base probe is ignored.** The head rewrites the pattern to `npm`: the result keeps base's pattern and sets `changedInHead`.
  - **The run budget.** With `maxRuns: 6` and two probes on the changed unit, the second is `not-run` with reason `run budget (6 runs)`.
  - **The time budget.** With `now` advancing 11 minutes per call and `maxMinutes: 20`, later runs do not start, and the reason names `time budget (20 min)`.
  - **The cache.**
    - A second `runEval` with the same base gives base `cached: 3`, and `totals.runs` is `3`: the head is the working tree and is not cached.
    - Changing the base probe's prompt misses the cache.
    - The number of `-p` invocations in the fake's argv log equals `totals.runs` each time.
  - **Errors.** Fake `exit: 1` for the head behaviour gives head `{ valid: 0, errors: [3 messages] }` and `status: 'inconclusive'`.
  - **A probe on unit `rule/nope.md`** throws `EvalError`.
  - **An `AGENTS.md` written into the parent of `workdir`** throws an `EvalError` naming it and `--workdir`. Without it, the run goes ahead.
  - **The tripwire.** Fake `touch: 'x.txt'` throws `EvalError` matching `/changed files in the copy: x\.txt/`.
  - **A `.claude/settings.json` in the base** gives `stripped` including `.claude/settings.json`.
  - **`targetLoaded`.** The head's `targetLoaded.predicted` is `3`: the fixture has no `CLAUDE.md`, so `AGENTS.md` comes from the fallback.
  - **The run root** is gone afterwards, and kept with `keepRuns`.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/eval/eval.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `runEval` and `status`.**
  - The head is scanned with `{ settings: base.registry }`, as `diff` does.
  - `utilizationBefore` and `utilizationAfter` are the first and last non-null `utilization` values.

- [ ] **Step 4: Run them and watch them pass,** then the whole suite. Mutation-check: each of these must fail a test.
  - Let the head definition win.
  - Drop the tree SHA from the key.
  - Gate on `regressed` alone.
  - Count errors as fails.
  - Skip the tripwire.
  - Skip the ancestor check.

- [ ] **Step 5: Commit.**

```bash
git add src/eval/eval.ts tests/eval/eval.test.ts
git commit -m "feat: paired base and head probe runs with a budget, a cache and an advisory gate"
```

---

### Task 6: `ctxlock eval`

**Files:**
- Modify: `src/registry/registry.ts`, `src/cli.ts` and `src/report/markdown.ts` (export `code` and `cell` for reuse).
- Create: `src/report/eval.ts` and `the-guide/evals.md`.
- Modify: `the-guide/commands.md`, `the-guide/configuration.md` and `the-guide/README.md`.
- Test: `tests/report/eval.test.ts`, `tests/cli.test.ts` and `tests/registry/registry.test.ts`.

**Interfaces:**
- **Consumes:** `runEval`, `EvalResult` and `EvalError` (Task 5), `ProbeError` (Task 3) and `ClaudeNotFound` (Task 2).
- **Produces:**
  - `Registry.eval: { model: string; runs: number; maxRuns: number; maxMinutes: number }`, defaulting to `sonnet`, 3, 24 and 20.
  - `renderEval(r: EvalResult, format: 'text' | 'json' | 'markdown'): string`.
  - The CLI command:
    ```
    ctxlock eval [dir] --base <ref> [--head <ref>]
      [--format text|json|markdown] [--runs <n>] [--max-runs <n>] [--max-minutes <n>]
      [--model <m>] [--claude <path>] [--workdir <dir>] [--cache <dir>]
      [--all] [--keep-runs] [--fail-on-regression]
    ```

- [ ] **Step 1: Write the failing tests.**
  - **Registry.** `eval: { model: claude-sonnet-5-5, runs: 5, max-runs: 30, max-minutes: 10 }` parses. An unknown key under `eval` gives `eval.x: unknown key`. `runs: 0` is an error. A missing `eval:` gives the defaults.
  - **CLI.** Use `--claude tests/helpers/fake-claude.mjs` and the Task 5 fixture.
    - It exits `0` and prints a text report.
    - It exits `1` only with `--fail-on-regression` and a gated regression.
    - It exits `2` with `Claude Code not found` for `--claude ctxlock-no-such-claude`, outside git, and on a `ProbeError`.
    - With `--format markdown`, a failure writes `renderErrorMarkdown`'s section.
    - Settings come from the **base** `ctxlock.yaml`: a head `eval.runs: 1` is ignored. Flags override settings.
  - **Markdown,** for a fixed `EvalResult`. The table rows are exactly:

```
| Probe | Unit | Base | Head | Result |
|---|---|---|---|---|
| `deps` | `instructions/AGENTS.md` | 0/3 | 3/3 | improved |
```

    The section also has:
    - the header `### ctxlock · behavioral check`;
    - a line naming Claude Code's version, the model reported by the run, and the runs per arm;
    - a line of 95% intervals under the table, such as `95% intervals (Wilson): deps base 0.00–0.56, head 0.44–1.00`;
    - a note naming both models when the arms' `models` differ;
    - for each probe, the target unit's loads in the head arm, with predicted loads marked;
    - median input tokens base → head, with the percentage change;
    - the cost line `Cost: 6 runs (0 cached) · 1m 12s · $0.26 notional on a subscription · 7-day usage window 57% → 57%`;
    - a `Not run` list with reasons;
    - the stripped execution config;
    - a footer: `Advisory. Probes ran on Claude Code only; Codex is predicted statically.`

    Probe IDs and unit IDs go through `code()`.
  - **No agent text anywhere.** The fake's behaviour runs `echo CANARY-7f3a` and replies `CANARY-reply`. `renderEval` in all three formats contains neither string, and nor does the CLI's stdout or stderr. Both directions: the `Transcript` from Task 2 does contain `CANARY-7f3a`.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/report/eval.test.ts tests/cli.test.ts tests/registry/registry.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add the `eval` strict object to the registry schema.
  - `--claude` takes a path. A `.js`, `.mjs` or `.cjs` path becomes `[process.execPath, path]`; anything else becomes `[path]`. The default is `['claude']`.
  - The workdir defaults to `process.env.RUNNER_TEMP ?? tmpdir()`, and the cache to `<workdir>/ctxlock-cache`.
  - `EvalError`, `ProbeError` and `ClaudeNotFound` join the CLI's known errors.

- [ ] **Step 4: Run them and watch them pass,** then mutation-check: render `t.commands` into the JSON, read the settings from the head, and drop `code()` on the probe ID. Each must fail a test.

- [ ] **Step 5: Write `the-guide/evals.md`,** checked against the code and tests, with examples that are run, not written. It covers:
  - what a probe is, and the two kinds;
  - the file format;
  - how a run is isolated, and what it cannot do;
  - **what leaves the machine:** the repository's context and the probe prompt go to the model, because running `ctxlock eval` sends them;
  - the budget, the cache and statuses, and the opt-in gate, with the Fisher note;
  - the predicted `AGENTS.md` loads (D37);
  - Windows (`claude.exe`, or `--claude <cli.js>`);
  - `--workdir`, and the ancestor refusal.

  Also add `eval` to `commands.md`, `eval:` to `configuration.md`, and the page to the guide README.

- [ ] **Step 6: Commit.**

```bash
git add src/registry/registry.ts src/cli.ts src/report/markdown.ts src/report/eval.ts tests the-guide
git commit -m "feat: ctxlock eval, the behavioral check from the command line"
```

---

### Task 7: `ctxlock probe draft`

**Files:**
- Create: `src/eval/draft.ts`.
- Modify: `src/cli.ts` and `the-guide/evals.md`.
- Test: `tests/eval/draft.test.ts` and `tests/cli.test.ts`.

**Interfaces:**
- **Consumes:** `scanRepo` and `fsReader`; `materialize` (Task 1); `runClaude` (Task 2); the probe schema and `grade` (Task 3).
- **Produces:**
  - `draftProbes(opts: DraftOptions): Promise<DraftResult>`, where:
    ```ts
    interface DraftOptions { root: string; unit: string; count: number; runs: number; maxRuns: number; model: string; claude: string[]; workdir: string; out?: string }
    interface DraftResult { path: string; kept: string[]; discarded: Array<{ id: string; reason: string }>; runs: number }
    class DraftError extends Error {}   // no usable reply, or the out file exists
    ```
  - `ctxlock probe draft [dir] --unit <id> [--count 4] [--runs 2] [--max-runs 24] [--model] [--claude] [--workdir] [--out <path>]`.

**Rules this task pins** (spec §5.2: drafted by an LLM from the units, reviewed once, committed; D11 and D36):
- **The drafting run** uses `runClaude` with `tools: []`, in an empty scratch folder. Its prompt has:
  - the unit's kind, path and text;
  - the probe schema;
  - for instructions and rules: `count` adherence probes, each a task a developer would give, where this unit decides the command or edit, naming a tool the agent would *not* pick without the unit;
  - for skills: `count / 2` should-trigger and `count / 2` should-not-trigger probes on `skill: <name>`;
  - "reply with one fenced yaml block".

  ctxlock sets each probe's `unit` itself. The model's value is ignored.
- **Validation:**
  - **Adherence.** Each candidate runs `runs` times in a **with** arm (a working-tree copy) and a **without** arm (the same copy with the unit's files deleted). It is kept only if every valid with-run passes and no without-run does.
  - **Trigger.** Each candidate runs `runs` times in the with arm only. A should-trigger probe is kept if every run invoked the skill; a should-not-trigger probe if none did.
  - **Discard reasons:**
    - `passes without the unit too (D36)`;
    - `fails with the unit`;
    - `invalid: <ProbeError message>`;
    - `run budget`.
- **Output.**
  - The default `out` is `evals/probes/<slug>.yaml`. The slug is `skill-<name>` for skills; otherwise the unit's path, lowercased, with runs of characters other than `[a-z0-9]` turned into `-`.
  - It refuses to write when the file exists (exit 2), and writes nothing when no candidate is kept.
  - The file starts with `# Drafted by ctxlock probe draft from <unit> (<digest>). Review before committing.`
  - The CLI prints the path, kept and discarded probes, and runs used, but no prompts or replies from the drafting run beyond the probe definitions that were kept.

- [ ] **Step 1: Write the failing tests** with the fake. Its `promptContains: 'Draft'` behaviour returns `text` with a YAML block of two candidates: `pnpm` (`\bpnpm\s+add\b`) and `ruff` (`\bruff\b`). The validation behaviours give `pnpm add zod` when `AGENTS.md` contains pnpm, and `ruff check .` in every arm.
  - **Only the probe that separates the arms is kept.** The file holds only the pnpm probe, with `unit: instructions/AGENTS.md`. `discarded` is `[{ id: <ruff id>, reason: 'passes without the unit too (D36)' }]`. `runs` is `1 + 2 × 2 × 2`.
  - **The drafting run's argv** has `--tools ''`, and its prompt contains the unit text.
  - **Refusal.** An existing out file exits 2 and stays unchanged.
  - **Bad replies.** A reply with no yaml block is a `DraftError` saying so. A candidate with `command: '(('` is discarded as `invalid: …`.
  - **Trigger probes.** A should-trigger probe that the fake triggers in 1 of 2 runs is discarded with `fails with the unit`.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/eval/draft.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement it,** with `DraftError` added to the CLI's known errors.

- [ ] **Step 4: Run them and watch them pass,** then mutation-check: skip the without arm, write over an existing file, and trust the model's `unit`. Each must fail a test.

- [ ] **Step 5: Add drafting to `the-guide/evals.md`,** including why a probe that passes without the unit is thrown away (S3's ruff).

- [ ] **Step 6: Commit.**

```bash
git add src/eval/draft.ts src/cli.ts tests the-guide/evals.md
git commit -m "feat: ctxlock probe draft, probes drafted from a unit and kept only if they tell the arms apart"
```

---

### Task 8: The behavioral section in the Action

**Files:**
- Modify: `action.yml`, `src/report/markdown.ts` (drop the footer `Static checks only. Behavioral evals come in a later release.`) and `tests/diff.test.ts:233`.
- Modify: `the-guide/github-action.md` and `README.md`.
- Test: `tests/action.test.ts`.

**Interfaces:**
- **Consumes:** `ctxlock eval --format markdown --cache <dir>` (Task 6).
- **Produces:**
  - **New inputs:**
    - `claude_code_oauth_token` and `anthropic_api_key`, both from secrets;
    - `eval`: `auto` (the default) or `false`;
    - `fail-on-regression` (default `'false'`);
    - `claude-code-version` (default `'2.1.292'`, the version S1–S4 verified; Task 9 updates it if it verifies a newer one).
  - **New output:** `eval-exit-code`.

**Steps added after `Check context`:**
- **`Install Claude Code`.** It runs only if `inputs.eval != 'false'` and a credential is set: `npm install -g "@anthropic-ai/claude-code@$VERSION" --no-audit --no-fund`.
- **`Restore eval cache`.** It uses `actions/cache@v4`, with `path: ${{ runner.temp }}/ctxlock-cache`, `key: ctxlock-eval-${{ github.event.pull_request.base.sha }}-${{ github.run_id }}` and `restore-keys: ctxlock-eval-${{ github.event.pull_request.base.sha }}-`.
- **`Behavioral check`** (`id: eval`). Inputs arrive only through `env`: `TOKEN`, `KEY`, `EVAL` and `BASE`. The script:
  - exports `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` **only when non-empty**, because an empty key in `-p` mode would override the token;
  - with `EVAL=false`, adds nothing;
  - with no credential, appends `#### Behavioral check` and `Skipped: no Claude credentials. Pull requests from forks get no secrets.`;
  - with an empty `BASE`, adds nothing, since the static step already reported;
  - otherwise runs `node "$GITHUB_ACTION_PATH/dist/cli.js" eval --base "$BASE" --format markdown --cache "$RUNNER_TEMP/ctxlock-cache" "$GITHUB_WORKSPACE"` into `ctxlock-eval.md`, plus `--fail-on-regression` when that input is true;
  - for a non-zero exit with an empty file, writes `Behavioral check could not run (exit N). The job log has the reason.`;
  - appends the file to `ctxlock.md`, and writes `eval-exit-code`.
- **`Result`.**
  - `EVAL_CODE=1` fails the job only when `fail-on-regression` is true.
  - `EVAL_CODE=2` prints `::warning title=ctxlock::behavioral check could not run` and does not fail the job.
  - The static rules are unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/action.test.ts`. They extend its stub `dist/cli.js`: argv `eval` prints its own section, prints whether `ANTHROPIC_API_KEY` is defined, and exits with a chosen code.
  - **No credential.** The skip note is appended, and the stub is never called; it would exit 9.
  - **With `TOKEN`.**
    - The eval section is appended after the static report.
    - `ANTHROPIC_API_KEY` is undefined in the stub, and `CLAUDE_CODE_OAUTH_TOKEN` is set.
    - `--fail-on-regression` is passed only when the input is `'true'`.
  - **A crash with no report** gives the fixed "could not run" text, and the raw stderr is not in `ctxlock.md`.
  - **Result step:**
    - `(CODE 0, EVAL_CODE 2)` exits 0;
    - `(0, 1)` exits 0, or 1 with `FAIL_ON_REGRESSION=true`;
    - `(1, 0)` still exits 1 with `FAIL_ON_MUST=true`.
  - **`action.yml` parses,** and every `${{ inputs.* }}` in a `run:` block is absent: inputs only go through `env`.
  - **`tests/diff.test.ts:233`** now asserts that the old footer is gone.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run tests/action.test.ts tests/diff.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the steps above.**

- [ ] **Step 4: Run them and watch them pass,** then mutation-check: export an empty `ANTHROPIC_API_KEY`, fail on `EVAL_CODE=2`, and interpolate `inputs.eval` into the script. Each must fail a test.

- [ ] **Step 5: Docs.** In `the-guide/github-action.md`, cover:
  - the credentials: `claude setup-token` for a subscription; an API key for a secret shared across repositories, per S1's quote of the docs;
  - forks;
  - cost per check;
  - the cache;
  - what is sent to Anthropic;
  - never `pull_request_target`.

  Update the README's roadmap and the "what it does" list.

- [ ] **Step 6: Commit.**

```bash
git add action.yml src/report/markdown.ts tests/action.test.ts tests/diff.test.ts the-guide/github-action.md README.md
git commit -m "feat: the Action runs the behavioral check when Claude credentials are set"
```

---

### Task 9: Live verification and the Phase 1 exit items (a) and (b)

Live runs, within the 200-run cap and the usage stop rule in Global Constraints. Every number in the report is read from saved output before the commit (mistakes.md, "Counting findings from memory").

**Files:**
- Create: `docs/dogfood/2026-11-XX-behavioral.md` and `journey/09-behavioral-ci.md`.
- Modify: `journey/decisions.md`, `journey/mistakes.md`, `journey/README.md`, the plan's progress table, `README.md` and the guide pages touched.

- [ ] **Step 1: Build and record.** Run `npm run build`, `claude --version` and the starting `seven_day.utilization` (from one run's stream). If `claude --version` is newer than 2.1.292, record that the Task 2 fixture is from 2.1.292. Update the `claude-code-version` default only after Steps 2–3 pass on the newer version.

- [ ] **Step 2: Isolation, live** (about 8 runs). Use a fixture repository under `.superpowers/live/` with `--workdir` outside the home folder, each case with a canary. A failure here stops the task: use superpowers:systematic-debugging, then fix test-first.
  1. **A skill with `allowed-tools: Bash` and frontmatter `hooks`** writing a marker file, plus a probe that makes the agent run a command. Expected: the command is denied, and the marker never appears. The strip and the deny both hold.
  2. **A probe asking the agent to read `../outside.txt`.** Expected: `outsideReads ≥ 1`, and `--keep-runs` shows that the canary inside `outside.txt` is absent from the stream.
  3. **A `CLAUDE.md` above the workdir** saying "always run `echo CANARY-ANCESTOR`". Expected: no `InstructionsLoaded` for it, and no canary command: `claudeMdExcludes` works from `--settings`. If not, make it a refusal like `AGENTS.md`, with a ruling and a test.
  4. **`CLAUDE.md` importing `@<absolute path>/outside.md`,** which holds a canary instruction. Expected: not loaded. The 2.1.292 binary loads external imports only when `hasClaudeMdExternalIncludesApproved` is set. If it is loaded, eval refuses arms whose always-on units import outside the repository: ruling, test, fix.

- [ ] **Step 3: Three public repositories.** Clone each into the workdir:
  - `openai/openai-agents-python` (`CLAUDE.md` → `AGENTS.md`);
  - `vercel-labs/skills` (`AGENTS.md` only, so its loads are predicted, D37);
  - one with a Claude-visible skill in `.claude/skills`, confirmed with `gh api repos/<r>/contents/.claude/skills`. Prefer the smallest of `getsentry/sentry`, `vercel/next.js` and `PostHog/posthog`, and record the checkout size.

  For each:
  - `ctxlock probe draft --unit <the instructions unit>`, and, for the skill repository, `--unit <a skill>`.
  - Review each kept probe once, by reading it, and commit it to the clone (local only, never pushed).
  - **(a)** In the working tree, edit the instruction the probe depends on so the required command changes (`uv` → `pip`, for example). Expected: `ctxlock eval --base HEAD` reports the probe `regressed`. Revert: no flag.
  - **(b)** In the skill repository, edit the skill's `description` so it no longer matches. Expected: the should-trigger probe is `regressed`. Revert: no flag.
  - Save every JSON result under `.superpowers/live/`.

- [ ] **Step 4: Write `docs/dogfood/2026-11-XX-behavioral.md`** from the saved JSON:
  - the repositories and commits;
  - the probes drafted, kept and discarded, with reasons;
  - (a) and (b) in both directions;
  - runs, minutes, notional cost and the usage window per check;
  - the isolation results.

- [ ] **Step 5: Docs.**
  - Write journey chapter 9.
  - Add decisions D38 onward for this plan's rulings:
    - the scope moves;
    - stripping execution config;
    - confining reads;
    - no agent text in outputs;
    - the base definition of a probe wins;
    - caching by git tree;
    - the gate rule;
    - Step 2's outcomes.
  - Add mistakes, if any.
  - Update the journey README, the README roadmap and this plan's progress table.

- [x] **Step 6: Verify and stop.** Done on [PR #1](https://github.com/SatyamSingh-Git/ctxlock/pull/1): the sticky comment carried the behavioral section, which said it was skipped, since the repository passes no Claude credentials.
  - Run `npm run ci` and report the real result.
  - **Ask Satyam** before pushing.
  - **Ask Satyam** before creating a test branch and pull request to see the Action live. That step checks the sticky comment with its behavioral section, the skip note on a run without the secret, and Plan 1 Task 13 Steps 3–4, still open.

---

## After this plan

- **Plan 3:** `ctxlock build` (a report, and `--fill-missing` through rulesync as an optional, exactly pinned dependency, per S2), with generated files in `.ctxlock/generated.json`.
- **Later:** golden tasks under an allowlist; L12; a Codex driver when someone with access contributes one; scheduled statistical evals (spec §5.2), which reuse `runEval` with more repeats and confidence intervals.
