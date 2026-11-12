// A stand-in for `gh issue list|create|edit`. It logs each call, with its stdin, to FAKE_GH_LOG, and acts
// as the JSON in FAKE_GH_SCENARIO says: `issues` is what `issue list` returns, and `fail` makes every call
// fail as gh does when it is not logged in.
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const stdin = argv.includes('--body-file') ? readFileSync(0, 'utf8') : null;
appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ argv, stdin })}\n`);
const scenario = JSON.parse(readFileSync(process.env.FAKE_GH_SCENARIO, 'utf8'));
if (scenario.fail) {
  process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\n');
  process.exit(4);
}
const repo = argv[argv.indexOf('-R') + 1];
// `searched`, when given, is what a --search finds: GitHub's search index lags behind new issues.
const listed = argv.includes('--search') && scenario.searched ? scenario.searched : scenario.issues;
if (argv[0] === 'issue' && argv[1] === 'list') process.stdout.write(JSON.stringify(listed ?? []));
if (argv[0] === 'issue' && argv[1] === 'create') process.stdout.write(`https://github.com/${repo}/issues/${scenario.next ?? 7}\n`);
