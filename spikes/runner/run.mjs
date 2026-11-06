// S1 spike: run `claude -p` in a throwaway copy of a fixture arm, with run-scoped hooks that record what
// loaded and what the agent tried to run, and deny every Bash, Write and Edit call.
// Usage: node run.mjs <arm dir> <prompt> <out dir> [--model <model>]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [arm, prompt, out, ...rest] = process.argv.slice(2);
const model = rest.includes('--model') ? rest[rest.indexOf('--model') + 1] : undefined;
const here = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/');
const slash = (p) => p.replaceAll('\\', '/');

// Not under the home folder: Claude Code walks up from the working directory and would load
// ~/.claude/CLAUDE.md as a parent project's file, so every probe would carry personal instructions.
const runs = join(here, '../../.superpowers/s1-runs');
mkdirSync(runs, { recursive: true });
const copy = mkdtempSync(join(runs, 'run-'));
cpSync(arm, copy, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: copy });

mkdirSync(out, { recursive: true });
const log = slash(join(out, 'events.jsonl'));
writeFileSync(log, '');
const hook = (event) => [{ type: 'command', command: `node "${here}hook.mjs" ${event} "${log}"` }];
const settings = {
  hooks: {
    InstructionsLoaded: [{ hooks: hook('InstructionsLoaded') }],
    PostToolUse: [{ matcher: 'Skill', hooks: hook('PostToolUse') }],
    PreToolUse: [{ matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit', hooks: hook('PreToolUse') }],
  },
};
const settingsFile = join(out, 'settings.json');
writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

function tree(dir) {
  return readdirSync(dir)
    .filter((n) => n !== '.git')
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? tree(path) : [`${slash(relative(copy, path))} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`];
    })
    .sort();
}
const before = tree(copy);

const args = [
  '-p', prompt,
  '--output-format', 'stream-json', '--verbose',
  '--settings', settingsFile,
  '--setting-sources', 'project',
  '--strict-mcp-config',
  // Only what probes need. The default set also has tools that publish or schedule outside the run
  // (Artifact, RemoteTrigger, CronCreate, PushNotification, ...); the hook then denies the ones that act.
  '--tools', 'Read,Glob,Grep,Bash,PowerShell,Edit,Write,Skill',
  '--no-session-persistence',
  ...(model ? ['--model', model] : []),
];
const started = Date.now();
const run = spawnSync('claude', args, { cwd: copy, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
writeFileSync(join(out, 'stream.jsonl'), run.stdout ?? '');
if (run.stderr) writeFileSync(join(out, 'stderr.txt'), run.stderr);

const messages = (run.stdout ?? '').split('\n').filter(Boolean).flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});
const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
const result = messages.findLast((m) => m.type === 'result');
const events = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const after = tree(copy);

const summary = {
  arm: slash(arm),
  prompt,
  exit: run.status,
  timedOut: run.error?.code === 'ETIMEDOUT',
  wallMs: Date.now() - started,
  init: init && { model: init.model, tools: init.tools, mcp_servers: init.mcp_servers, plugins: init.plugins, slash_commands: init.slash_commands?.length, permissionMode: init.permissionMode },
  result: result && { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns, duration_ms: result.duration_ms, total_cost_usd: result.total_cost_usd, usage: result.usage, text: String(result.result ?? '').slice(0, 400) },
  loaded: events.filter((e) => e.event === 'InstructionsLoaded').map((e) => ({ file: slash(relative(copy, e.payload.file_path ?? '')), reason: e.payload.load_reason, parent: e.payload.parent_file_path ? slash(relative(copy, e.payload.parent_file_path)) : undefined })),
  skills: events.filter((e) => e.event === 'PostToolUse').map((e) => e.payload.tool_input),
  denied: events.filter((e) => e.event === 'PreToolUse').map((e) => ({ tool: e.payload.tool_name, input: e.payload.tool_input?.command ?? e.payload.tool_input?.file_path })),
  unchanged: JSON.stringify(before) === JSON.stringify(after),
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
