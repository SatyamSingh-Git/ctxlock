// S3: reproduce the direction of two published effects with the S1 harness.
// (1) Adherence (ETH Zurich): a tool named in AGENTS.md gets used; an unnamed one does not.
// (2) Index vs skill (Vercel): a compact index in CLAUDE.md beats docs behind a skill.
// Usage: node s3.mjs <out dir> <adherence|index> [repeats] [--model <model>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [out, part, repeats = '3', ...rest] = process.argv.slice(2);
const model = rest.includes('--model') ? ['--model', rest[rest.indexOf('--model') + 1]] : [];
const here = fileURLToPath(new URL('.', import.meta.url));
const runner = join(here, '../runner/run.mjs');
const arms = join(here, '../../.superpowers/s3-arms');

const conventions = '# Conventions\n\n- Keep functions small and named for what they do.\n- Write a test for every bug fix.\n';
const pkg = (extra = {}) => JSON.stringify({ name: 's3-fixture', version: '1.0.0', private: true, ...extra }, null, 2);
const pyproject = '[project]\nname = "s3-fixture"\nversion = "0.1.0"\ndependencies = []\n';

// Each task: files both arms share, the line only the head arm's AGENTS.md has, the prompt, and the
// tool whose use is counted in the intended commands.
const ADHERENCE = [
  { id: 'uv', files: { 'pyproject.toml': pyproject, 'app.py': 'print("hi")\n' }, line: '- Manage Python dependencies with uv: `uv add <package>`, and run code with `uv run`.', prompt: 'Add the requests library as a dependency.', tool: /\buv\b/ },
  { id: 'pnpm', files: { 'package.json': pkg(), 'index.js': 'export const one = 1;\n' }, line: '- Use pnpm for every package command, never npm.', prompt: 'Add zod as a dependency.', tool: /\bpnpm\b/ },
  { id: 'bun', files: { 'package.json': pkg({ scripts: { test: 'node --test' } }), 'sum.test.js': "import test from 'node:test';\ntest('ok', () => {});\n" }, line: '- Use bun to run scripts and tests: `bun test`.', prompt: 'Run the tests.', tool: /\bbun\b/ },
  { id: 'ruff', files: { 'pyproject.toml': pyproject, 'app.py': 'import os\nprint( "hi" )\n' }, line: '- Lint Python with ruff: `ruff check .`.', prompt: 'Lint the Python code.', tool: /\bruff\b/ },
  { id: 'just', files: { Makefile: 'build:\n\tnode build.js\n', justfile: 'build:\n    node build.js\n', 'build.js': 'console.log("built");\n' }, line: '- Build with `just build`.', prompt: 'Build the project.', tool: /\bjust\b/ },
];

const DOCS = {
  'docs/sync.md': '# Sync worker\n\nThe sync worker retries a failed batch 7 times (`SYNC_MAX_RETRIES`) before it gives up and pages the on-call.\n',
  'docs/billing.md': '# Billing\n\nAn unpaid invoice gets a grace period of 11 days before the account is suspended.\n',
  'docs/auth.md': '# Authentication\n\nSession tokens expire after 37 minutes of inactivity.\n',
  'docs/storage.md': '# Storage\n\nUploads are capped at 23 MB per file.\n',
  'docs/release.md': '# Releases\n\nThe current release is codenamed Heron.\n',
};
const QUESTIONS = [
  { id: 'retries', prompt: 'How many times does the sync worker retry a failed batch before giving up? Reply with only the number.', answer: /\b7\b/ },
  { id: 'grace', prompt: 'How many days is the grace period for an unpaid invoice? Reply with only the number.', answer: /\b11\b/ },
  { id: 'session', prompt: 'After how many minutes of inactivity do session tokens expire? Reply with only the number.', answer: /\b37\b/ },
  { id: 'upload', prompt: 'What is the upload size cap per file, in MB? Reply with only the number.', answer: /\b23\b/ },
  { id: 'codename', prompt: 'What is the codename of the current release? Reply with only the codename.', answer: /\bheron\b/i },
];
const INDEX = [
  conventions,
  '\n## Project docs index\n\nAnswers about this project are in docs/. Read the file before answering.\n\n',
  'topic|file\n---|---\nsync worker, retries|docs/sync.md\nbilling, invoices, grace period|docs/billing.md\nauthentication, sessions, tokens|docs/auth.md\nstorage, uploads, size limits|docs/storage.md\nreleases, codenames|docs/release.md\n',
].join('');
const SKILL = [
  '---',
  'name: project-docs',
  'description: Reference for this project: the sync worker, billing, authentication, storage limits and releases. Use when asked how any of these work or are configured.',
  '---',
  'Read the matching file in docs/ before answering: docs/sync.md, docs/billing.md, docs/auth.md, docs/storage.md, docs/release.md.',
  '',
].join('\n');
const INDEX_ARMS = {
  skill: { 'CLAUDE.md': conventions, '.claude/skills/project-docs/SKILL.md': SKILL, ...DOCS },
  index: { 'CLAUDE.md': INDEX, ...DOCS },
  none: { 'CLAUDE.md': conventions, ...DOCS },
};

function materialize(files) {
  mkdirSync(arms, { recursive: true });
  const dir = mkdtempSync(join(arms, 'arm-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

function run(files, prompt, name) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('node', [runner, materialize(files), prompt, dir, ...model], { stdio: 'ignore' });
  return JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
}

const usage = (s) => ({ turns: s.result?.num_turns, durationMs: s.result?.duration_ms, costUsd: s.result?.total_cost_usd, error: s.result?.is_error !== false, unchanged: s.unchanged });
const rows = [];
if (part === 'adherence') {
  for (const task of ADHERENCE) {
    for (const arm of ['base', 'head']) {
      const agents = arm === 'head' ? `${conventions}${task.line}\n` : conventions;
      for (let i = 1; i <= Number(repeats); i++) {
        const s = run({ ...task.files, 'AGENTS.md': agents }, task.prompt, `${task.id}-${arm}-${i}`);
        const commands = s.denied.map((d) => d.input ?? '');
        const uses = commands.filter((c) => task.tool.test(c)).length;
        rows.push({ task: task.id, arm, run: i, uses, commands, loaded: s.loaded.map((l) => `${l.file} (${l.reason})`), ...usage(s) });
        console.log(`${task.id} ${arm} ${i}: uses=${uses} ${JSON.stringify(commands)}`);
      }
    }
  }
} else {
  for (const q of QUESTIONS) {
    for (const [arm, files] of Object.entries(INDEX_ARMS)) {
      for (let i = 1; i <= Number(repeats); i++) {
        const s = run(files, q.prompt, `${q.id}-${arm}-${i}`);
        const text = s.result?.text ?? '';
        rows.push({ question: q.id, arm, run: i, correct: q.answer.test(text), answer: text.slice(0, 80), skill: s.skills.length > 0, loaded: s.loaded.map((l) => `${l.file} (${l.reason})`), ...usage(s) });
        console.log(`${q.id} ${arm} ${i}: correct=${rows.at(-1).correct} skill=${rows.at(-1).skill} ${JSON.stringify(rows.at(-1).answer)}`);
      }
    }
  }
}
writeFileSync(join(out, `${part}.json`), JSON.stringify(rows, null, 2));
