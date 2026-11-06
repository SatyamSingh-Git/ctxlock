import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK_SCRIPT } from './hook-script.js';
import { ancestorExcludes } from './workspace.js';

// Read-only tools, the shell, and the editing tools whose attempts probes grade (the hook denies
// those). Claude Code's default set also has tools that publish or schedule things outside the run.
export const PROBE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell', 'Edit', 'Write', 'Skill'];
const HOOKED = 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Read|Glob|Grep';
const SHELLS = new Set(['Bash', 'PowerShell']);
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export interface ClaudeRun {
  dir: string;
  scratch: string;
  prompt: string;
  model: string;
  claude: string[];
  tools?: string[];
  timeoutMs?: number;
}

// Paths are relative to the run folder in POSIX form, or absolute when outside it.
export interface ObservedLoad {
  path: string;
  reason: string;
  parent?: string;
  trigger?: string;
}

export interface Transcript {
  model: string | null;
  version: string | null;
  turns: number;
  durationMs: number;
  wallMs: number;
  // Input, cache reads and cache writes together: what the context cost.
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  utilization: number | null;
  commands: string[];
  edits: string[];
  skills: string[];
  listedSkills: string[];
  loads: ObservedLoad[];
  denied: number;
  outsideReads: number;
  // The final reply. Probe drafting reads it; no report ever shows it.
  text: string;
  error: string | null;
}

type StreamFacts = Omit<Transcript, 'loads' | 'denied' | 'outsideReads' | 'wallMs'>;

export class ClaudeNotFound extends Error {}

// The prompt goes on stdin, not here: a drafting prompt carries a whole unit, and Windows caps a
// command line at 32,767 characters.
export function claudeArgs(opts: { model: string; tools: string[] }, settingsPath: string): string[] {
  return [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--settings', settingsPath,
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--tools', opts.tools.join(','),
    '--no-session-persistence',
    '--model', opts.model,
  ];
}

export function claudeSettings(hook: (event: string) => string, excludes: string[]): Record<string, unknown> {
  const run = (event: string) => [{ type: 'command', command: hook(event) }];
  return {
    claudeMdExcludes: excludes,
    hooks: {
      InstructionsLoaded: [{ hooks: run('InstructionsLoaded') }],
      PostToolUse: [{ matcher: 'Skill', hooks: run('PostToolUse') }],
      PreToolUse: [{ matcher: HOOKED, hooks: run('PreToolUse') }],
    },
  };
}

const slash = (p: string) => p.replaceAll('\\', '/');

export function relativeTo(root: string, file: string): string | null {
  const r = slash(root).replace(/\/+$/, '');
  const f = slash(file);
  const fold = /^[A-Za-z]:\//.test(r) ? (s: string) => s.toLowerCase() : (s: string) => s;
  return fold(f).startsWith(`${fold(r)}/`) ? f.slice(r.length + 1) : null;
}

const place = (dir: string, path: string) => relativeTo(dir, path) ?? slash(path);

// The stream-json fields ctxlock reads, as Claude Code 2.1.292 writes them.
interface StreamMessage {
  type?: string;
  subtype?: string;
  model?: string;
  claude_code_version?: string;
  skills?: string[];
  message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
  rate_limit_info?: { unifiedWindows?: { seven_day?: { utilization?: number } } };
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  api_error_status?: number | null;
  result?: unknown;
  usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
}

export function parseStream(text: string, dir: string): StreamFacts {
  const facts: StreamFacts = {
    model: null, version: null, turns: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, utilization: null,
    commands: [], edits: [], skills: [], listedSkills: [], text: '', error: null,
  };
  let result = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // A partial line at a timeout or crash is not JSON; the run's error says why.
    let m: StreamMessage;
    try {
      m = JSON.parse(line) as StreamMessage;
    } catch {
      continue;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      facts.model = m.model ?? null;
      facts.version = m.claude_code_version ?? null;
      facts.listedSkills = m.skills ?? [];
    } else if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) {
        if (c.type !== 'tool_use' || c.name === undefined) continue;
        if (SHELLS.has(c.name) && typeof c.input?.command === 'string') facts.commands.push(c.input.command);
        const file = c.input?.file_path ?? c.input?.notebook_path;
        if (EDITS.has(c.name) && typeof file === 'string') facts.edits.push(place(dir, file));
        if (c.name === 'Skill' && typeof c.input?.skill === 'string') facts.skills.push(c.input.skill);
      }
    } else if (m.type === 'rate_limit_event') {
      facts.utilization = m.rate_limit_info?.unifiedWindows?.seven_day?.utilization ?? facts.utilization;
    } else if (m.type === 'result') {
      result = true;
      const u = m.usage ?? {};
      facts.turns = m.num_turns ?? 0;
      facts.durationMs = m.duration_ms ?? 0;
      facts.costUsd = m.total_cost_usd ?? 0;
      facts.inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      facts.outputTokens = u.output_tokens ?? 0;
      facts.text = typeof m.result === 'string' ? m.result : '';
      if (m.is_error) facts.error = m.api_error_status ? `${m.subtype} (API status ${m.api_error_status})` : String(m.subtype);
    }
  }
  if (!result) facts.error = 'Claude Code ended without a result';
  return facts;
}

// A script path runs with this Node, so `--claude` can point at an npm install's cli.js.
const command = (claude: string[]) => (/\.[cm]?js$/.test(claude[0]!) ? [process.execPath, ...claude] : claude);

interface Exit {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  // Node's own reason for stopping the process, such as output past maxBuffer.
  failure: string | null;
}

function spawnClaude(claude: string[], args: string[], cwd: string | undefined, timeoutMs: number, input = ''): Promise<Exit> {
  const [file, ...pre] = command(claude);
  return new Promise((resolve, reject) => {
    const child = execFile(
      file!,
      [...pre, ...args],
      { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } },
      (err, stdout, stderr) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          reject(new ClaudeNotFound(`Claude Code not found (${claude[0]}): install it, or pass --claude <path>`));
          return;
        }
        const errCode = (err as { code?: unknown } | null)?.code;
        const failure = typeof errCode === 'string' ? err!.message : null;
        const timedOut = failure === null && (err as { killed?: boolean } | null)?.killed === true;
        resolve({ code: err === null ? 0 : typeof errCode === 'number' ? errCode : null, stdout, stderr, timedOut, failure });
      },
    );
    // A process that exits without reading its input would make the write fail; its exit says why.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export async function claudeVersion(claude: string[]): Promise<string> {
  const { stdout } = await spawnClaude(claude, ['--version'], undefined, 30_000);
  const version = /^\s*(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
  if (!version) throw new Error(`could not read the Claude Code version from: ${stdout.trim().slice(0, 200)}`);
  return version;
}

export async function runClaude(run: ClaudeRun): Promise<Transcript> {
  const timeoutMs = run.timeoutMs ?? 300_000;
  mkdirSync(run.scratch, { recursive: true });
  const hookFile = join(run.scratch, 'hook.mjs');
  const log = join(run.scratch, 'events.jsonl');
  const settingsFile = join(run.scratch, 'settings.json');
  writeFileSync(hookFile, HOOK_SCRIPT);
  writeFileSync(log, '');
  // Paths in / form: hook commands run through a shell, and bash would read backslashes as escapes.
  const hook = (event: string) => `"${slash(process.execPath)}" "${slash(hookFile)}" ${event} "${slash(log)}" "${slash(run.dir)}"`;
  writeFileSync(settingsFile, JSON.stringify(claudeSettings(hook, ancestorExcludes(run.dir)), null, 2));

  const started = Date.now();
  const exit = await spawnClaude(run.claude, claudeArgs({ model: run.model, tools: run.tools ?? PROBE_TOOLS }, settingsFile), run.dir, timeoutMs, run.prompt);
  const wallMs = Date.now() - started;
  writeFileSync(join(run.scratch, 'stream.jsonl'), exit.stdout);
  if (exit.stderr) writeFileSync(join(run.scratch, 'stderr.txt'), exit.stderr);

  const facts = parseStream(exit.stdout, run.dir);
  const events = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const loads = events
    .filter((e) => e.event === 'InstructionsLoaded')
    .map(({ payload: p }): ObservedLoad => ({
      path: place(run.dir, p.file_path),
      reason: p.load_reason,
      ...(p.parent_file_path ? { parent: place(run.dir, p.parent_file_path) } : {}),
      ...(p.trigger_file_path ? { trigger: place(run.dir, p.trigger_file_path) } : {}),
    }));
  const pre = events.filter((e) => e.event === 'PreToolUse');
  const firstLine = exit.stderr.split('\n')[0]!.trim().slice(0, 200);
  let error = facts.error;
  if (exit.failure) error = `claude failed: ${exit.failure}`;
  else if (exit.timedOut) error = `timed out after ${timeoutMs} ms`;
  else if (exit.code !== 0) error = `claude exited ${exit.code}${firstLine ? `: ${firstLine}` : ''}`;

  return { ...facts, wallMs, loads, denied: pre.filter((e) => !e.outside).length, outsideReads: pre.filter((e) => e.outside).length, error };
}
