// ctxlock's collector. Claude Code runs it on SessionStart, InstructionsLoaded and Skill calls, and it
// appends one line per event to <CTXLOCK_HOME or ~/.ctxlock>/events/<YYYY-MM>.jsonl for `ctxlock loads`.
// It records paths, digests and reasons, never content: not a file, a prompt, a tool's input beyond a
// skill's name, its output, or the environment, which holds the tokens of whatever started Claude Code.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.CTXLOCK_HOME || join(homedir(), '.ctxlock');
const ts = new Date().toISOString();

function append(line) {
  const folder = join(home, 'events');
  mkdirSync(folder, { recursive: true });
  appendFileSync(join(folder, `${ts.slice(0, 7)}.jsonl`), JSON.stringify(line) + '\n');
}

// Hashed as ctxlock's scan hashes a file, with CRLF read as LF, so the two compare. The file can be
// gone by the time the hook runs.
function digest(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return null;
  }
  const text = bytes.includes(0x0d) ? Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1') : bytes;
  return createHash('sha256').update(text).digest('hex');
}

function lineFor(p) {
  const base = { v: 1, ts, harness: 'claude-code', session: p.session_id, cwd: p.cwd };
  switch (p.hook_event_name) {
    case 'SessionStart':
      return { ...base, event: 'session_start', source: p.source };
    case 'InstructionsLoaded':
      return { ...base, event: 'load', file: p.file_path, sha256: digest(p.file_path), reason: p.load_reason, trigger: p.trigger_file_path, parent: p.parent_file_path };
    case 'PostToolUse':
      return { ...base, event: 'skill', skill: p.tool_input.skill };
    default:
      return null;
  }
}

// A collector must never get in a session's way, so whatever happens it prints nothing and exits 0.
try {
  const line = lineFor(JSON.parse(readFileSync(0, 'utf8')));
  if (line) append(line);
} catch (err) {
  // A parse error quotes the input it failed on, and a Skill call's input can hold content.
  const message = err instanceof SyntaxError ? 'the hook input is not JSON' : String(err.message);
  try {
    append({ v: 1, ts, event: 'error', message });
  } catch {
    // Nowhere left to report it.
  }
}
