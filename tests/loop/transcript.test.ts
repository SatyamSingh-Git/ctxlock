import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { redact } from '../../src/loop/redact.js';
import { CORRECTION, findTranscript, readTranscript, transcriptsHome } from '../../src/loop/transcript.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

// Read just after the fixtures were written, so a session that ends mid-tool isn't yet abandoned.
const SOON = new Date('2026-11-11T10:30:00.000Z');
const t = (second: number) => `2026-11-11T10:00:${String(second).padStart(2, '0')}.000Z`;
const base = (second: number) => ({ parentUuid: null, isSidechain: false, timestamp: t(second), sessionId: 's1', cwd: 'F:\\repo' });
// A prompt the person typed, in the shape Claude Code 2.1 writes.
const typed = (second: number, text: string) => ({ ...base(second), type: 'user', origin: { kind: 'human' }, promptSource: 'sdk', turnOrigin: 'human', message: { role: 'user', content: [{ type: 'text', text }] } });
// Older versions mark it only with turnOrigin, and write the content as a string.
const typedOld = (second: number, text: string) => ({ ...base(second), type: 'user', turnOrigin: 'human', message: { role: 'user', content: text } });
const said = (second: number, text = 'Done.') => ({ ...base(second), type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (second: number, name: string, input: object = {}) => ({ ...base(second), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${second}`, name, input }] } });
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

    expect(await readTranscript(file, 's1', SOON)).toEqual({
      session: 's1',
      prompts: [t(1), t(4)],
      compactions: [],
      signals: [
        { kind: 'interrupted', ts: t(3), untrusted: false, task: 'add a dependency for dates', actions: [{ tool: 'Bash', target: '' }] },
        { kind: 'correction', ts: t(4), untrusted: false, words: 'no, use pnpm add', task: 'add a dependency for dates', actions: [{ tool: 'Bash', target: '' }] },
      ],
    });
  });

  it("a signal carries the opening of the prompt that began its turn, and the agent's actions since, with each tool's target", async () => {
    const file = transcript([
      typed(1, 'add the dayjs package'),
      tool(2, 'Read', { file_path: 'package.json' }),
      tool(3, 'Bash', { command: 'npm install dayjs', description: 'install' }),
      interrupt(4),
      typed(5, 'no, we use pnpm here'),
      tool(6, 'Grep', { pattern: 'dayjs' }),
      typed(7, 'stop, that was enough'),
    ]);

    const [stopped, corrected, again] = (await readTranscript(file, 's1', SOON)).signals;
    expect(stopped).toMatchObject({ kind: 'interrupted', task: 'add the dayjs package', actions: [{ tool: 'Read', target: 'package.json' }, { tool: 'Bash', target: 'npm install dayjs' }] });
    // A correction answers the turn before it.
    expect(corrected).toMatchObject({ kind: 'correction', task: 'add the dayjs package', actions: [{ tool: 'Read', target: 'package.json' }, { tool: 'Bash', target: 'npm install dayjs' }] });
    expect(again).toMatchObject({ kind: 'correction', task: 'no, we use pnpm here', actions: [{ tool: 'Grep', target: 'dayjs' }] });
  });

  it('actions stop at 20, and a target at 200 characters; pasted text is not in the task', async () => {
    const many = Array.from({ length: 25 }, (_, i) => tool(2 + i, 'Bash', { command: `echo ${i} ${'x '.repeat(150)}` }));
    const file = transcript([typed(1, `fix it <pasted_content id="p">secret paste</pasted_content id="p"> ${'please '.repeat(60)}`), ...many, interrupt(40)]);

    const [signal] = (await readTranscript(file, 's1', SOON)).signals;
    expect(signal!.actions).toHaveLength(20);
    expect(signal!.actions[0]!.target).toHaveLength(200);
    expect(signal!.task).toBe(`fix it   ${'please '.repeat(41)}please`);
    expect(signal!.task).not.toContain('secret');
  });

  it('a cut never splits a run of non-space characters, so a token at the cut keeps the shape redact knows', async () => {
    // Built here, so no token-shaped string sits in the repository.
    const token = `ghp_${'Ab1'.repeat(12)}`;
    const file = transcript([
      typed(1, `${'a '.repeat(140)}${token} done`),
      tool(2, 'Bash', { command: `${'b '.repeat(90)}${token} more` }),
      tool(3, 'Bash', { command: `echo ${'x'.repeat(1000)}` }),
      tool(4, 'Bash', { command: `${'d '.repeat(100)}next` }),
      said(4),
      typed(5, `no, ${'c '.repeat(76)}${token} ok`),
    ]);

    const [signal] = (await readTranscript(file, 's1', SOON)).signals;
    expect(signal!.task!.endsWith(token)).toBe(true);
    expect(signal!.actions[0]!.target.endsWith(token)).toBe(true);
    expect(signal!.words!.endsWith(token)).toBe(true);
    for (const text of [signal!.task!, signal!.actions[0]!.target, signal!.words!]) expect(redact(text)).not.toContain('ghp_');
    // A run longer than any token is still cut, 200 characters past the cut at most.
    expect(signal!.actions[1]!.target).toHaveLength(400);
    // A cut right after a space takes nothing of the next word.
    expect(signal!.actions[2]!.target).toBe('d '.repeat(100));
  });

  it('a search that found nothing marks its action empty, matched by its tool_use_id, and a result with an image or text is not empty', async () => {
    const call = (second: number, id: string, name: string, input: object) => ({ ...base(second), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const back = (second: number, id: string, content: unknown) => ({ ...base(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
    const file = transcript([
      typed(1, 'find the retry helper'),
      call(2, 'g1', 'Grep', { pattern: 'retryWithBackoff' }),
      call(3, 'g2', 'Glob', { pattern: 'src/**/retry*.ts' }),
      // Results come back out of order, after other lines.
      back(4, 'g2', [{ type: 'text', text: 'src/net/retry.ts' }]),
      back(5, 'g1', 'No matches found'),
      call(6, 'm1', 'mcp__docs__search', { query: 'retry' }),
      back(7, 'm1', []),
      call(8, 'r1', 'Read', { file_path: 'a.png' }),
      back(9, 'r1', [{ type: 'image', source: {} }]),
      call(10, 'r2', 'Read', { file_path: 'empty.ts' }),
      back(11, 'r2', ''),
      call(12, 'g3', 'Glob', { pattern: 'lib/**' }),
      back(13, 'g3', 'No files found'),
      call(14, 'g4', 'Grep', { pattern: 'backoff' }),
      back(15, 'g4', ''),
      call(16, 'm2', 'mcp__docs__diagram', { query: 'retry' }),
      back(17, 'm2', [{ type: 'image', source: {} }]),
      // An MCP tool that writes says nothing back when it works; one whose name says it reads is a search.
      call(20, 'm3', 'mcp__github__create_issue', { title: 'retry' }),
      back(21, 'm3', ''),
      call(22, 'm4', 'mcp__github__list_issues', { query: 'retry' }),
      back(23, 'm4', ''),
      call(24, 'm5', 'mcp__gmail__searchThreads', { query: 'retry' }),
      back(25, 'm5', ''),
      // The server's name doesn't make its tools lookups.
      call(28, 'm6', 'mcp__search__create_index', { query: 'retry' }),
      back(29, 'm6', ''),
      call(30, 'm7', 'mcp__docs__SearchPages', { query: 'retry' }),
      back(31, 'm7', ''),
      said(32),
      typed(33, 'no, it is in src/net'),
    ]);

    const [signal] = (await readTranscript(file, 's1', SOON)).signals;
    expect(signal!.actions).toEqual([
      { tool: 'Grep', target: 'retryWithBackoff', empty: true },
      { tool: 'Glob', target: 'src/**/retry*.ts' },
      { tool: 'mcp__docs__search', target: 'retry', empty: true },
      { tool: 'Read', target: 'a.png' },
      // Only a search finding nothing counts: an empty file read is not a gap.
      { tool: 'Read', target: 'empty.ts' },
      { tool: 'Glob', target: 'lib/**', empty: true },
      { tool: 'Grep', target: 'backoff', empty: true },
      // A diagram is something, though it has no text.
      { tool: 'mcp__docs__diagram', target: 'retry' },
      { tool: 'mcp__github__create_issue', target: '' },
      { tool: 'mcp__github__list_issues', target: 'retry', empty: true },
      { tool: 'mcp__gmail__searchThreads', target: 'retry', empty: true },
      { tool: 'mcp__search__create_index', target: 'retry' },
      { tool: 'mcp__docs__SearchPages', target: 'retry', empty: true },
    ]);
  });

  it('a session that ends on an interrupt, a tool call, a tool result or an unanswered prompt, an hour or more ago, is abandoned at its last line; one that ends on an answer, or less than an hour ago, is not', async () => {
    const later = new Date('2026-11-11T11:00:59.000Z');
    const abandoned = async (tail: object[], now = later) => (await readTranscript(transcript([typed(1, 'add the endpoint'), ...tail]), 's1', now)).signals.filter((s) => s.kind === 'abandoned');

    expect(await abandoned([tool(2, 'Bash', { command: 'npm test' })])).toEqual([{ kind: 'abandoned', ts: t(2), untrusted: false, task: 'add the endpoint', actions: [{ tool: 'Bash', target: 'npm test' }] }]);
    expect((await abandoned([tool(2, 'Bash'), result(3, 'ok')])).map((s) => s.ts)).toEqual([t(3)]);
    expect((await abandoned([said(2), typed(3, 'and the tests')])).map((s) => s.ts)).toEqual([t(3)]);
    expect((await abandoned([tool(2, 'Bash'), interrupt(3)])).map((s) => s.ts)).toEqual([t(3)]);
    expect(await abandoned([said(2)])).toEqual([]);
    // Less than an hour after its last line, the session may still be going: this one, say.
    expect(await abandoned([tool(2, 'Bash')], new Date('2026-11-11T10:59:59.000Z'))).toEqual([]);
    // A /compact then closing the session: the summary carries the human mark, but nothing was left unanswered.
    const SUMMARY = 'This session is being continued from a previous conversation that ran out of context.';
    expect(await abandoned([said(2), typed(3, SUMMARY)])).toEqual([]);
    // A claude -p run has no typed prompt: nobody left it.
    const headless = transcript([{ ...base(1), type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'run it' }] } }, tool(2, 'Bash')]);
    expect((await readTranscript(headless, 's1', later)).signals).toEqual([]);
  });

  it('a session waiting on a subagent is quiet only once the subagent is: its own transcript counts', async () => {
    const file = transcript([typed(1, 'review the branch'), tool(2, 'Agent', { description: 'review' })]);
    const subagents = join(dirname(file), 's1', 'subagents');
    mkdirSync(subagents, { recursive: true });
    const agentAt = (ts: string) => writeFileSync(join(subagents, 'agent-a1.jsonl'), `${JSON.stringify({ ...tool(3, 'Read'), timestamp: '2026-11-11T10:00:03.000Z', isSidechain: true })}\n${JSON.stringify({ ...tool(4, 'Grep'), timestamp: ts, isSidechain: true })}\n`);
    const kinds = async (now: string) => (await readTranscript(file, 's1', new Date(now))).signals.map((s) => s.kind);

    // Two hours after the Agent call, its subagent wrote ten minutes ago: still going.
    agentAt('2026-11-11T11:50:00.000Z');
    expect(await kinds('2026-11-11T12:00:00.000Z')).toEqual([]);
    // An hour after the subagent's last line, the session is abandoned, at the main thread's last line.
    expect((await readTranscript(file, 's1', new Date('2026-11-11T12:50:00.000Z'))).signals).toMatchObject([{ kind: 'abandoned', ts: t(2) }]);
    // A subagent quiet as long as the session changes nothing.
    agentAt('2026-11-11T10:00:05.000Z');
    expect(await kinds('2026-11-11T12:00:00.000Z')).toEqual(['abandoned']);
    // A subagent that finished long before the session's last line doesn't make the session older.
    const busy = transcript([typed(1, 'review the branch'), { ...tool(2, 'Bash'), timestamp: '2026-11-11T11:30:00.000Z' }]);
    mkdirSync(join(dirname(busy), 's1', 'subagents'), { recursive: true });
    writeFileSync(join(dirname(busy), 's1', 'subagents', 'agent-a1.jsonl'), `${JSON.stringify({ ...tool(3, 'Read'), isSidechain: true })}\n`);
    expect((await readTranscript(busy, 's1', new Date('2026-11-11T12:00:00.000Z'))).signals).toEqual([]);
  });

  it("a subagent's actions are not the turn's", async () => {
    const file = transcript([typed(1, 'start'), { ...tool(2, 'Bash', { command: 'rm -rf build' }), isSidechain: true }, tool(3, 'Read', { file_path: 'a.ts' }), interrupt(4)]);

    expect((await readTranscript(file, 's1', SOON)).signals[0]!.actions).toEqual([{ tool: 'Read', target: 'a.ts' }]);
  });

  it("a long correction keeps only its opening, without pasted text, as its words", async () => {
    const file = transcript([typed(1, 'start'), said(2), typed(3, `no, <pasted_content id="p">secret</pasted_content id="p"> use ${'the shared helper '.repeat(20)}`)]);

    const words = (await readTranscript(file, 's1', SOON)).signals[0]!.words!;
    // 160 characters, to the end of the word the cut falls in.
    expect(words).toBe(`no,   use ${'the shared helper '.repeat(8)}the shared`);
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

    expect((await readTranscript(file, 's1', SOON)).signals).toEqual([]);
  });

  it('a prompt before the agent\'s first answer, a claude -p prompt, a meta line and a sidechain line are no correction', async () => {
    const file = transcript([
      typed(1, 'no tests yet, add some'),
      said(2),
      { ...base(3), type: 'user', promptSource: 'sdk', turnOrigin: 'sdk', message: { role: 'user', content: 'no, use npm' } },
      { ...typed(4, 'no, use yarn'), isMeta: true },
      { ...typed(5, 'no, use bun'), isSidechain: true },
    ]);

    const read = await readTranscript(file, 's1', SOON);
    expect(read.signals).toEqual([]);
    expect(read.prompts).toEqual([t(1)]);
  });

  it('a signal after WebFetch, WebSearch or an MCP tool is untrusted, and one before is not', async () => {
    for (const name of ['WebFetch', 'WebSearch', 'mcp__github__get_issue']) {
      const file = transcript([typed(1, 'start'), said(2), interrupt(3), tool(4, name), interrupt(5)]);
      expect((await readTranscript(file, 's1', SOON)).signals.map((s) => s.untrusted), name).toEqual([false, true]);
    }
    const file = transcript([typed(1, 'start'), tool(2, 'Read'), interrupt(3)]);
    expect((await readTranscript(file, 's1', SOON)).signals[0]!.untrusted).toBe(false);
  });

  it("a signal after a subagent's web fetch is untrusted too, read from the session's subagent transcripts", async () => {
    const file = transcript([typed(1, 'start'), said(2), interrupt(3), interrupt(5)]);
    const subagents = join(dirname(file), 's1', 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-a1.jsonl'), `${JSON.stringify({ ...tool(4, 'WebFetch'), isSidechain: true })}\n`);
    writeFileSync(join(subagents, 'agent-a1.meta.json'), '{}');

    expect((await readTranscript(file, 's1', SOON)).signals.map((s) => s.untrusted)).toEqual([false, true]);
    // A second subagent, read after the first, fetched earlier still.
    writeFileSync(join(subagents, 'agent-b2.jsonl'), `${JSON.stringify({ ...tool(2, 'WebSearch'), isSidechain: true })}\n`);
    expect((await readTranscript(file, 's1', SOON)).signals.map((s) => s.untrusted)).toEqual([true, true]);

    // Older versions write the subagent's lines into the session's own file.
    const inline = transcript([typed(1, 'start'), said(2), interrupt(3), { ...tool(4, 'mcp__docs__search'), isSidechain: true }, interrupt(5)]);
    expect((await readTranscript(inline, 's1', SOON)).signals.map((s) => s.untrusted)).toEqual([false, true]);
  });

  it("records when the session was compacted, and not when a subagent's was", async () => {
    const boundary = (second: number) => ({ ...base(second), type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' });
    const file = transcript([typed(1, 'start'), said(2), boundary(3), { ...boundary(4), isSidechain: true }, said(5), boundary(6)]);

    expect((await readTranscript(file, 's1', SOON)).compactions).toEqual([t(3), t(6)]);
  });

  it('a last line cut short is skipped and the rest is read', async () => {
    const file = transcript([typed(1, 'start'), said(2), interrupt(3)], JSON.stringify(interrupt(4)).slice(0, 40));

    expect((await readTranscript(file, 's1', SOON)).signals.map((s) => s.ts)).toEqual([t(3)]);
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
