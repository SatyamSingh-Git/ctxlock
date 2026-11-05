// S2 spike: import a fixture with rulesync's library API, generate for four agents, and compare what
// ctxlock predicts each agent loads before and after. Usage: node run.mjs [--cli]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ctxlock = join(here, '../../dist/cli.js');
const repo = mkdtempSync(join(tmpdir(), 'ctxlock-s2-'));
cpSync(join(here, 'fixture'), repo, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
git('init', '-q');
git('add', '.');
git('-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', 'commit', '-qm', 'fixture');

const scan = () => JSON.parse(execFileSync('node', [ctxlock, 'scan', repo, '--format', 'json'], { encoding: 'utf8' }));
const lint = () => {
  try {
    return execFileSync('node', [ctxlock, 'lint', repo], { encoding: 'utf8' });
  } catch (err) {
    return err.stdout;
  }
};
const files = (dir = repo) =>
  readdirSync(dir).flatMap((name) => {
    if (name === '.git') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [relative(repo, path).split('\\').join('/')];
  });
const loads = (s) =>
  s.contexts.map((c) => `${c.harness} @ ${c.site || '.'}: ${c.entries.map((e) => `${e.path} (${e.mode})`).join(', ') || 'nothing'}`);

const before = scan();
const lintBefore = lint();
const filesBefore = new Set(files());

process.chdir(repo);
const targets = ['claudecode', 'codexcli', 'copilot', 'cursor'];
const features = ['rules', 'skills'];
if (process.argv.includes('--cli')) {
  const cli = join(here, 'node_modules/rulesync/dist/cli/index.js');
  for (const target of ['claudecode', 'agentsmd', 'agentsskills']) execFileSync('node', [cli, 'import', '--targets', target, '--features', features.join(',')], { stdio: 'inherit' });
  execFileSync('node', [cli, 'generate', '--targets', targets.join(','), '--features', features.join(',')], { stdio: 'inherit' });
} else {
  const { importFromTool, generate } = await import('rulesync');
  for (const target of ['claudecode', 'agentsmd', 'agentsskills']) {
    console.log(`import ${target}:`, JSON.stringify(await importFromTool({ target, features, silent: true })));
  }
  const result = await generate({ targets, features, silent: true });
  console.log('generate:', JSON.stringify(Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number' || Array.isArray(v)))));
}

const after = scan();
console.log(`\nrepo: ${repo}`);
console.log('\nsource tree (.rulesync):');
for (const f of files().filter((f) => f.startsWith('.rulesync/'))) console.log(`  ${f}`);
console.log('\nfiles generated or changed outside .rulesync:');
for (const f of files().filter((f) => !f.startsWith('.rulesync/'))) {
  const changed = !filesBefore.has(f) ? 'new' : git('status', '--porcelain', '--', f).trim() ? 'changed' : null;
  if (changed) console.log(`  ${changed.padEnd(7)} ${f}`);
}
console.log('\nloads before:');
for (const line of loads(before)) console.log(`  ${line}`);
console.log('loads after:');
for (const line of loads(after)) console.log(`  ${line}`);
console.log('\nlint before:\n' + lintBefore.trimEnd().replace(/^/gm, '  '));
console.log('lint after:\n' + lint().trimEnd().replace(/^/gm, '  '));
