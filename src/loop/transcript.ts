import { createReadStream, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type SignalKind = 'interrupted' | 'correction';

export interface Signal {
  kind: SignalKind;
  ts: string;
  // The session had read a web page or an MCP tool's output by then (D81).
  untrusted: boolean;
  // A correction's opening, for --excerpts only.
  words?: string;
}

export interface SessionTranscript {
  session: string;
  // When the person typed each prompt, in order.
  prompts: string[];
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
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string };
  turnOrigin?: string;
  message?: { content?: unknown };
}

type Block = { type?: string; text?: string; name?: string };

const texts = (content: unknown): string[] =>
  typeof content === 'string' ? [content] : Array.isArray(content) ? (content as Block[]).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!) : [];

// Transcripts run past 100 MB, so they are streamed. Only user and assistant lines matter.
export async function readTranscript(file: string, session: string): Promise<SessionTranscript> {
  const prompts: string[] = [];
  const signals: Signal[] = [];
  let answered = false;
  let untrusted = false;
  for await (const text of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!text.includes('"type":"user"') && !text.includes('"type":"assistant"')) continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      // The session is still writing its last line.
      continue;
    }
    if (line.isSidechain || typeof line.timestamp !== 'string') continue;
    const ts = line.timestamp;
    const content = line.message?.content;

    if (line.type === 'assistant') {
      answered = true;
      if (Array.isArray(content) && (content as Block[]).some((b) => b.type === 'tool_use' && typeof b.name === 'string' && untrustedTool(b.name))) untrusted = true;
      continue;
    }
    if (line.type !== 'user') continue;

    if (texts(content).some((t) => INTERRUPT.test(t))) {
      signals.push({ kind: 'interrupted', ts, untrusted });
      continue;
    }
    if (line.isMeta || (line.origin?.kind !== 'human' && line.turnOrigin !== 'human')) continue;
    const prompt = texts(content).join('\n').trim();
    if (!prompt) continue;
    prompts.push(ts);
    if (!answered || prompt.startsWith(SUMMARY)) continue;
    const opening = prompt.replace(PASTED, ' ').trim().slice(0, 160);
    if (CORRECTION.some((r) => r.test(opening))) signals.push({ kind: 'correction', ts, untrusted, words: opening });
  }
  return { session, prompts, signals };
}
