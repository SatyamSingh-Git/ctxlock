// A stand-in for `claude -p ... --output-format stream-json`. It runs the hook commands from the
// --settings file through a shell, the way Claude Code does, and obeys their decisions, so tests
// exercise ctxlock's real hooks. The scenario comes from the JSON file in FAKE_CLAUDE_SCENARIO.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const cwd = process.cwd();
if (process.env.FAKE_CLAUDE_ARGV_LOG) {
  const defined = (name) => process.env[name] !== undefined;
  const line = { argv, cwd, nonessential: defined('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'), apiKey: defined('ANTHROPIC_API_KEY'), oauthToken: defined('CLAUDE_CODE_OAUTH_TOKEN') };
  appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, `${JSON.stringify(line)}\n`);
}

const scenario = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, 'utf8'));
if (argv[0] === '--version') {
  process.stdout.write(`${scenario.version ?? '2.1.292'} (Claude Code)\n`);
  process.exit(0);
}
if (scenario.exit) {
  process.stderr.write(scenario.stderr ?? '');
  process.exit(scenario.exit);
}

const arg = (flag) => argv[argv.indexOf(flag) + 1];
const prompt = arg('-p');
const settings = JSON.parse(readFileSync(arg('--settings'), 'utf8'));
const out = [];
const emit = (message) => out.push(JSON.stringify(message));

function runHooks(event, toolName, payload) {
  const decisions = [];
  for (const group of settings.hooks?.[event] ?? []) {
    if (group.matcher && !new RegExp(`^(?:${group.matcher})$`).test(toolName)) continue;
    for (const h of group.hooks) {
      const r = spawnSync(h.command, { shell: true, input: JSON.stringify({ hook_event_name: event, cwd, ...payload }), encoding: 'utf8' });
      if (r.stdout.trim()) decisions.push(JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision);
    }
  }
  return decisions;
}

emit({ type: 'system', subtype: 'init', cwd, model: scenario.model ?? 'claude-sonnet-5-5', claude_code_version: scenario.version ?? '2.1.292', skills: scenario.skills ?? [], tools: arg('--tools').split(',') });

let loadedBytes = 0;
for (const load of scenario.loads ?? []) {
  const file = join(cwd, load.file);
  if (!existsSync(file)) continue;
  loadedBytes += statSync(file).size;
  runHooks('InstructionsLoaded', '', { file_path: file, memory_type: 'Project', load_reason: load.reason, ...(load.parent ? { parent_file_path: join(cwd, load.parent) } : {}) });
}

const matches = (when) =>
  !when ||
  (when.promptContains !== undefined ? prompt.includes(when.promptContains) : existsSync(join(cwd, when.file)) && readFileSync(join(cwd, when.file), 'utf8').includes(when.contains));
const behaviour = (scenario.behaviours ?? []).find((b) => matches(b.when)) ?? { calls: [] };

let id = 0;
for (const call of behaviour.calls ?? []) {
  const toolUseId = `toolu_${++id}`;
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: toolUseId, name: call.tool, input: call.input }] } });
  const denied = runHooks('PreToolUse', call.tool, { tool_name: call.tool, tool_input: call.input }).includes('deny');
  if (!denied && call.tool === 'Write') writeFileSync(resolve(cwd, call.input.file_path), call.input.content ?? '');
  if (!denied && call.tool === 'Skill') runHooks('PostToolUse', 'Skill', { tool_name: 'Skill', tool_input: call.input });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: denied, content: denied ? 'denied by hook' : 'ok' }] } });
}

if (scenario.touch) writeFileSync(join(cwd, scenario.touch), 'written behind the hooks');
if (scenario.floodMiB) for (let i = 0; i < scenario.floodMiB; i++) process.stdout.write(`${'x'.repeat(1024 * 1024 - 1)}\n`);
if (scenario.sleepMs) await new Promise((r) => setTimeout(r, scenario.sleepMs));

emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.57 } } } });
const failed = scenario.apiErrorStatus != null;
if (!scenario.noResult) emit({
  type: 'result',
  subtype: failed ? 'error_during_execution' : 'success',
  is_error: failed,
  api_error_status: scenario.apiErrorStatus ?? null,
  num_turns: (behaviour.calls ?? []).length + 1,
  duration_ms: 1200,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1000 + loadedBytes, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 50 },
  result: scenario.text ?? 'done',
});
process.stdout.write(`${out.join('\n')}\n`);
