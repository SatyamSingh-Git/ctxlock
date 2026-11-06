// S4: run Claude Code sessions with load hooks on a fixture, join each observed load to a ctxlock unit by
// path and content digest, and compare with what `ctxlock scan` predicts. Usage: node s4.mjs <out dir> [--model <model>]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [out, ...rest] = process.argv.slice(2);
const model = rest.includes('--model') ? ['--model', rest[rest.indexOf('--model') + 1]] : [];
const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../..');

const FILES = {
  'CLAUDE.md': '# Project\n\n- Prefer small commits.\n\n@AGENTS.md\n',
  'AGENTS.md': '# Shared conventions\n\n- Use pnpm, never npm.\n',
  '.claude/rules/style.md': '# Style\n\n- Name functions for what they do.\n',
  '.claude/rules/api.md': '---\npaths: ["packages/api/**"]\n---\n# API\n\n- Validate every input with zod.\n',
  '.claude/skills/release/SKILL.md': '---\nname: release\ndescription: Cuts a release. Use when asked to publish a new version.\n---\n1. Bump the version in package.json.\n2. Tag the commit.\n',
  '.agents/skills/notes/SKILL.md': '---\nname: notes\ndescription: Writes meeting notes. Use when asked to take notes.\n---\nWrite the notes in notes/.\n',
  'packages/api/CLAUDE.md': '# API package\n\n- Handlers live in handler.ts.\n',
  'packages/api/handler.ts': 'export const handler = () => "ok";\n',
  'packages/web/AGENTS.md': '# Web package\n\n- Components are in app.ts.\n',
  'packages/web/app.ts': 'export const App = () => "web";\n',
  'package.json': '{ "name": "s4-fixture", "version": "1.0.0", "private": true }\n',
};
const SESSIONS = [
  { id: 'api', prompt: 'Read packages/api/handler.ts and tell me in one sentence what it exports.' },
  { id: 'web', prompt: 'Read packages/web/app.ts and tell me in one sentence what it exports.' },
  { id: 'release', prompt: 'Publish a new version of this project.' },
];

const arms = join(root, '.superpowers/s4-arms');
mkdirSync(arms, { recursive: true });
const arm = mkdtempSync(join(arms, 'arm-'));
for (const [path, text] of Object.entries(FILES)) {
  mkdirSync(dirname(join(arm, path)), { recursive: true });
  writeFileSync(join(arm, path), text);
}
// Its own repository, so ctxlock reads this folder rather than the gitignored corner of this one.
execFileSync('git', ['init', '-q'], { cwd: arm });
const scan = JSON.parse(execFileSync('node', [join(root, 'dist/cli.js'), 'scan', arm, '--format', 'json'], { encoding: 'utf8' }));

const sha = (text) => createHash('sha256').update(text).digest('hex');
// A one-file unit's digest is sha256 of "<path>\0<sha256 of the file>\n"; a skill is joined by its folder.
function unitFor(path) {
  const skill = scan.units.find((u) => u.kind === 'skill' && path === `${u.path}/SKILL.md`);
  if (skill) return { id: skill.id, contentMatches: null };
  const unit = scan.units.find((u) => u.path === path || u.aliases.includes(path));
  if (!unit) return { id: null, contentMatches: null };
  const digest = `sha256:${sha(`${unit.path}\0${sha(readFileSync(join(arm, unit.path)))}\n`)}`;
  return { id: unit.id, contentMatches: digest === unit.digest };
}

const sessions = SESSIONS.map((session) => {
  const dir = join(out, session.id);
  execFileSync('node', [join(root, 'spikes/runner/run.mjs'), arm, session.prompt, dir, ...model], { stdio: 'ignore' });
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cwd = events[0]?.payload.cwd;
  const rel = (p) => (p && cwd ? relative(cwd, p).split('\\').join('/') : p);
  const loads = events
    .filter((e) => e.event === 'InstructionsLoaded')
    .map((e) => ({ path: rel(e.payload.file_path), reason: e.payload.load_reason, trigger: rel(e.payload.trigger_file_path), parent: rel(e.payload.parent_file_path), globs: e.payload.globs, ...unitFor(rel(e.payload.file_path)) }));
  const skills = events.filter((e) => e.event === 'PostToolUse').map((e) => e.payload.tool_input?.skill ?? e.payload.tool_input?.command ?? JSON.stringify(e.payload.tool_input));
  console.log(`--- session ${session.id}: ${session.prompt}`);
  for (const l of loads) console.log(`  loaded ${l.path} (${l.reason}${l.trigger ? `, trigger ${l.trigger}` : ''}${l.parent ? `, parent ${l.parent}` : ''}) -> ${l.id ?? 'NO UNIT'}${l.contentMatches === false ? ' CONTENT MISMATCH' : ''}`);
  for (const s of skills) console.log(`  skill ${s}`);
  console.log(`  denied ${JSON.stringify(summary.denied)} unchanged=${summary.unchanged}`);
  return { ...session, loads, skills, denied: summary.denied, unchanged: summary.unchanged, turns: summary.result?.num_turns };
});

const context = scan.contexts.find((c) => c.harness === 'claude-code' && c.site === '');
console.log('\n--- predicted for claude-code at the root');
for (const e of context.entries) console.log(`  ${e.mode.padEnd(6)} ${e.path} (${e.reason}) -> ${e.unitId}`);
for (const n of context.notes) console.log(`  note: ${n}`);
writeFileSync(join(out, 's4.json'), JSON.stringify({ predicted: context, units: scan.units.map((u) => u.id), sessions }, null, 2));
