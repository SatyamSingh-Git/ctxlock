import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CORRECTION, findTranscript, readTranscript, transcriptsHome } from '../../src/loop/transcript.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

const t = (second: number) => `2026-11-11T10:00:${String(second).padStart(2, '0')}.000Z`;
const base = (second: number) => ({ parentUuid: null, isSidechain: false, timestamp: t(second), sessionId: 's1', cwd: 'F:\\repo' });
// A prompt the person typed, in the shape Claude Code 2.1 writes.
const typed = (second: number, text: string) => ({ ...base(second), type: 'user', origin: { kind: 'human' }, promptSource: 'sdk', turnOrigin: 'human', message: { role: 'user', content: [{ type: 'text', text }] } });
// Older versions mark it only with turnOrigin, and write the content as a string.
const typedOld = (second: number, text: string) => ({ ...base(second), type: 'user', turnOrigin: 'human', message: { role: 'user', content: text } });
const said = (second: number, text = 'Done.') => ({ ...base(second), type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (second: number, name: string) => ({ ...base(second), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${second}`, name, input: {} }] } });
const result = (second: number, text: string) => ({ ...base(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: text, is_error: false }] } });
const interrupt = (second: number) => ({ ...base(second), type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });

function transcript(lines: object[], tail = ''): string {
  const file = join(tempDir(), 's1.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n' + tail);
  return file;
}

describe('readTranscript', () => {
  it("finds an interrupt and a correction, each with its time, and the typed prompts' times", async () => {
    const file = transcript([
      { type: 'session-owner', sessionId: 's1' },
      typed(1, 'add a dependency for dates'),
      tool(2, 'Bash'),
      interrupt(3),
      typedOld(4, 'no, use pnpm add'),
      said(5),
    ]);

    expect(await readTranscript(file, 's1')).toEqual({
      session: 's1',
      prompts: [t(1), t(4)],
      signals: [
        { kind: 'interrupted', ts: t(3), untrusted: false },
        { kind: 'correction', ts: t(4), untrusted: false, words: 'no, use pnpm add' },
      ],
    });
  });

  it("a long correction keeps only its opening, without pasted text, as its words", async () => {
    const file = transcript([typed(1, 'start'), said(2), typed(3, `no, <pasted_content id="p">secret</pasted_content id="p"> use ${'the shared helper '.repeat(20)}`)]);

    const words = (await readTranscript(file, 's1')).signals[0]!.words!;
    expect(words).toHaveLength(160);
    expect(words.startsWith('no,   use the shared helper')).toBe(true);
    expect(words).not.toContain('secret');
  });

  it('a marker or a phrase quoted in a tool result, pasted text or a compaction summary is no signal', async () => {
    const file = transcript([
      typed(1, 'find the markers'),
      said(2),
      result(3, '[Request interrupted by user]'),
      result(4, 'no, I meant the other file'),
      { ...base(5), type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'see [Request interrupted by user] in the log' }] } },
      typed(6, 'here is the doc: <pasted_content id="a1">no, I meant the old flow</pasted_content id="a1"> summarize it'),
      typed(7, 'This session is being continued from a previous conversation that ran out of context. The user said "no, I meant the prompt".'),
      // Only the opening is read: a phrase deep in a long prompt is not a correction.
      typed(8, `${'Here is the plan for the release notes and the changelog. '.repeat(3)}Then I meant to add a section.`),
    ]);

    expect((await readTranscript(file, 's1')).signals).toEqual([]);
  });

  it('a prompt before the agent\'s first answer, a claude -p prompt, a meta line and a sidechain line are no correction', async () => {
    const file = transcript([
      typed(1, 'no tests yet, add some'),
      said(2),
      { ...base(3), type: 'user', promptSource: 'sdk', turnOrigin: 'sdk', message: { role: 'user', content: 'no, use npm' } },
      { ...typed(4, 'no, use yarn'), isMeta: true },
      { ...typed(5, 'no, use bun'), isSidechain: true },
    ]);

    const read = await readTranscript(file, 's1');
    expect(read.signals).toEqual([]);
    expect(read.prompts).toEqual([t(1)]);
  });

  it('a signal after WebFetch, WebSearch or an MCP tool is untrusted, and one before is not', async () => {
    for (const name of ['WebFetch', 'WebSearch', 'mcp__github__get_issue']) {
      const file = transcript([typed(1, 'start'), said(2), interrupt(3), tool(4, name), interrupt(5)]);
      expect((await readTranscript(file, 's1')).signals.map((s) => s.untrusted), name).toEqual([false, true]);
    }
    const file = transcript([typed(1, 'start'), tool(2, 'Read'), interrupt(3)]);
    expect((await readTranscript(file, 's1')).signals[0]!.untrusted).toBe(false);
  });

  it('a last line cut short is skipped and the rest is read', async () => {
    const file = transcript([typed(1, 'start'), said(2), interrupt(3)], JSON.stringify(interrupt(4)).slice(0, 40));

    expect((await readTranscript(file, 's1')).signals.map((s) => s.ts)).toEqual([t(3)]);
  });
});

describe('findTranscript', () => {
  it("finds a session's file under any project folder, under CLAUDE_CONFIG_DIR, and gives null when there is none", () => {
    const config = tempDir();
    const home = transcriptsHome({ CLAUDE_CONFIG_DIR: config });
    expect(home).toBe(join(config, 'projects'));
    expect(findTranscript(home, 's1')).toBeNull();

    mkdirSync(join(home, 'F--repo'), { recursive: true });
    mkdirSync(join(home, 'F--repo-sub'), { recursive: true });
    writeFileSync(join(home, 'F--repo-sub', 's1.jsonl'), '');
    expect(findTranscript(home, 's1')).toBe(join(home, 'F--repo-sub', 's1.jsonl'));
    expect(findTranscript(home, 's2')).toBeNull();
    expect(findTranscript(join(config, 'absent'), 's1')).toBeNull();
  });
});

describe('CORRECTION', () => {
  const corrects = (text: string) => CORRECTION.some((r) => r.test(text));

  it('matches "no, use pnpm", "I meant the other file" and "actually, leave it", and not "now add tests", "nothing else" or "I\'d actually like…"', () => {
    for (const text of ['no, use pnpm', 'I meant the other file', 'actually, leave it', "that's wrong", 'why did you delete it']) expect(corrects(text), text).toBe(true);
    for (const text of ['now add tests', 'nothing else', "I'd actually like a table", 'notice the header', 'stopwatch module', 'this has no tests', "I'd like it to stop at 5"])expect(corrects(text), text).toBe(false);
  });
});
