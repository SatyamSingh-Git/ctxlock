// Does generate({ check: true }) notice a hand edit to a generated file? Usage: node check.mjs <repo from run.mjs>
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
process.chdir(repo);
const { generate } = await import('rulesync');
const options = { targets: ['claudecode', 'codexcli', 'copilot', 'cursor'], features: ['rules', 'skills'], check: true, silent: true };

async function check(label) {
  try {
    const result = await generate(options);
    console.log(`${label}: resolved; rulesPaths ${JSON.stringify(result.rulesPaths)}`);
  } catch (err) {
    console.log(`${label}: threw ${err.message.split('\n')[0]}`);
  }
}

await check('fresh output');
appendFileSync(join(repo, 'CLAUDE.md'), '\n- Edited by hand.\n');
await check('after a hand edit to CLAUDE.md');
