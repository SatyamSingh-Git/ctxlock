import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

export type SignalKind = 'interrupted' | 'correction';

export interface Signal {
  kind: SignalKind;
  ts: string;
  // The session had read a web page or an MCP tool's output by then (D81).
  untrusted: boolean;
  // A correction's opening, for --excerpts only.
  words?: string;
  // The opening of the prompt that began the signal's turn, and what the agent did since: what diagnose
  // sends, redacted (D83).
  task?: string;
  actions: Action[];
}

export interface Action {
  tool: string;
  // Its command, path or pattern.
  target: string;
}

export interface SessionTranscript {
  session: string;
  // When the person typed each prompt, in order.
  prompts: string[];
  // When the session was compacted: what loaded before is summarised away.
  compactions: string[];
  signals: Signal[];
}

// D79. Checked on Satyam's own prompts: 5 of 676 matched, all genuine corrections.
export const CORRECTION = [
  /^(no|nope|nah|wrong|stop|undo|revert)\b/i,
  /^(that'?s|this is|it'?s|thats) (not|wrong)\b/i,
  /^actually\b/i,
  /\b(i meant|i said|i asked( you)?|i told you|not what i|you (forgot|missed|ignored|skipped)|why did you|why are you|you should(n'?t| not)? have|don'?t do that)\b/i,
];

const INTERRUPT = /^\[Request interrupted by user( for tool use)?\]$/;
const SUMMARY = 'This session is being continued from a previous conversation';
const PASTED = /<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g;
const untrustedTool = (name: string) => name === 'WebFetch' || name === 'WebSearch' || name.startsWith('mcp__');

export const transcriptsHome = (env: NodeJS.ProcessEnv = process.env) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

// Claude Code names a project's folder after the directory a session started in, so the session ID is
// the only reliable key.
export function findTranscript(home: string, session: string): string | null {
  if (!statSync(home, { throwIfNoEntry: false })?.isDirectory()) return null;
  for (const project of readdirSync(home)) {
    const file = join(home, project, `${session}.jsonl`);
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  return null;
}

interface Line {
  type?: string;
  subtype?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string };
  turnOrigin?: string;
  message?: { content?: unknown };
}

type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown> };

const TARGETS = ['command', 'file_path', 'path', 'pattern', 'skill', 'url', 'query'];

const actionsOf = (content: unknown): Action[] =>
  Array.isArray(content)
    ? (content as Block[])
        .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
        .map((b) => ({ tool: b.name!, target: String(TARGETS.map((k) => b.input?.[k]).find((v) => typeof v === 'string') ?? '').slice(0, 200) }))
    : [];

const openingOf = (prompt: string, length: number) => prompt.replace(PASTED, ' ').trim().slice(0, length);

const texts = (content: unknown): string[] =>
  typeof content === 'string' ? [content] : Array.isArray(content) ? (content as Block[]).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!) : [];

const lines = (file: string) => createInterface({ input: createReadStream(file), crlfDelay: Infinity });
const readsUntrusted = (line: Line) =>
  line.type === 'assistant' && Array.isArray(line.message?.content) && (line.message.content as Block[]).some((b) => b.type === 'tool_use' && typeof b.name === 'string' && untrustedTool(b.name));

// A subagent keeps its own transcript beside the session's, and what it read reaches the session in its
// report: the earliest web or MCP read there marks every signal after it.
async function firstUntrustedInSubagents(file: string, session: string): Promise<string | null> {
  const folder = join(dirname(file), session, 'subagents');
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return null;
  let first: string | null = null;
  for (const name of readdirSync(folder).filter((n) => n.endsWith('.jsonl'))) {
    for await (const text of lines(join(folder, name))) {
      if (!text.includes('"type":"assistant"')) continue;
      let line: Line;
      try {
        line = JSON.parse(text) as Line;
      } catch {
        continue;
      }
      if (typeof line.timestamp === 'string' && readsUntrusted(line) && (first === null || line.timestamp < first)) first = line.timestamp;
    }
  }
  return first;
}

// Transcripts run past 100 MB, so they are streamed. Only user and assistant lines matter.
export async function readTranscript(file: string, session: string): Promise<SessionTranscript> {
  const prompts: string[] = [];
  const compactions: string[] = [];
  const signals: Signal[] = [];
  const fromSubagent = await firstUntrustedInSubagents(file, session);
  let answered = false;
  let untrusted = false;
  // The current turn: the prompt that began it, and what the agent has done since.
  let task: string | undefined;
  let actions: Action[] = [];
  for await (const text of lines(file)) {
    if (!text.includes('"type":"user"') && !text.includes('"type":"assistant"') && !text.includes('"compact_boundary"')) continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      // The session is still writing its last line.
      continue;
    }
    if (typeof line.timestamp !== 'string') continue;
    // Older versions write a subagent's lines into the session's own file.
    if (readsUntrusted(line)) untrusted = true;
    if (line.isSidechain) continue;
    const ts = line.timestamp;
    const content = line.message?.content;
    if (fromSubagent !== null && fromSubagent <= ts) untrusted = true;
    if (line.type === 'system' && line.subtype === 'compact_boundary') compactions.push(ts);

    if (line.type === 'assistant') {
      answered = true;
      if (actions.length < 20) actions = [...actions, ...actionsOf(content)].slice(0, 20);
      continue;
    }
    if (line.type !== 'user') continue;

    const turn = { ...(task !== undefined && { task }), actions };
    if (texts(content).some((t) => INTERRUPT.test(t))) {
      signals.push({ kind: 'interrupted', ts, untrusted, ...turn });
      continue;
    }
    if (line.isMeta || (line.origin?.kind !== 'human' && line.turnOrigin !== 'human')) continue;
    const prompt = texts(content).join('\n').trim();
    if (!prompt) continue;
    prompts.push(ts);
    // A new turn begins; a compaction's summary is no one's task.
    const summary = prompt.startsWith(SUMMARY);
    task = summary ? undefined : openingOf(prompt, 300);
    actions = [];
    if (!answered || summary) continue;
    const opening = openingOf(prompt, 160);
    if (CORRECTION.some((r) => r.test(opening))) signals.push({ kind: 'correction', ts, untrusted, words: opening, ...turn });
  }
  return { session, prompts, compactions, signals };
}
