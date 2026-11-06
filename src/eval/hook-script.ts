// The run-scoped hook, written next to each run's settings and run with the current Node:
//   node hook.mjs <event> <log.jsonl> <run folder>
// It appends each event to the log. On PreToolUse it denies every tool that acts, and every read
// outside the run folder, so nothing the agent intends runs and it reads only its own copy.
export const HOOK_SCRIPT = String.raw`import { appendFileSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const [event, log, root] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(0, 'utf8'));
const record = (extra) => appendFileSync(log, JSON.stringify({ event, ...extra, payload }) + '\n');
const deny = (reason) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));

const ACTS = new Set(['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function inside(path) {
  const rel = relative(fold(resolve(root)), fold(resolve(payload.cwd ?? root, path)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
// A glob that starts at an absolute path or climbs out with .. reaches past the folder it is given.
const climbs = (glob) => typeof glob === 'string' && (isAbsolute(glob) || /^[A-Za-z]:/.test(glob) || glob.split(/[\\/]/).includes('..'));

if (event !== 'PreToolUse') {
  record({});
} else if (ACTS.has(payload.tool_name)) {
  record({});
  deny('observe-and-deny: this run records the intended action and does not execute it');
} else {
  const input = payload.tool_input ?? {};
  const target = input.file_path ?? input.path ?? '.';
  if (!inside(target) || (payload.tool_name === 'Glob' && climbs(input.pattern)) || climbs(input.glob)) {
    record({ outside: true });
    deny('outside the run folder: this run reads only its own copy of the repository');
  }
}
`;
