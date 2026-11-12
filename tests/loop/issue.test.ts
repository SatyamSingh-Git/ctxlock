import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { githubRepo, IssueError, openIssue } from '../../src/loop/issue.js';
import { cleanup, tempDir } from '../helpers/repo.js';

afterAll(cleanup);

const GH = [resolve('tests/helpers/fake-gh.mjs')];
const MARKER = '<!-- ctxlock:fix rule/.claude/rules/deps.md ';
let log: string;

function scenario(o: object) {
  const file = join(tempDir(), 'gh.json');
  writeFileSync(file, JSON.stringify(o));
  process.env.FAKE_GH_SCENARIO = file;
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; stdin: string | null }) : []);

beforeEach(() => {
  log = join(tempDir(), 'gh.jsonl');
  process.env.FAKE_GH_LOG = log;
  scenario({});
});

describe('githubRepo', () => {
  it('reads https, ssh and scp GitHub URLs, and gives null for a local path or another host', () => {
    for (const url of ['https://github.com/acme/web.git', 'https://github.com/acme/web', 'ssh://git@github.com/acme/web.git', 'git@github.com:acme/web.git']) expect(githubRepo(url), url).toBe('acme/web');
    for (const url of ['../org', 'C:\\src\\org', 'https://gitlab.com/acme/web.git', 'https://gitlab.com/mirror/https://github.com/acme/web', 'org']) expect(githubRepo(url), url).toBeNull();
  });
});

describe('openIssue', () => {
  it('files a new issue with the body on stdin', async () => {
    const body = `${MARKER}sha256:1 -->\n# ctxlock: a proposed fix\n`;

    const r = await openIssue('acme/web', 'ctxlock: rule/.claude/rules/deps.md needs a look', body, MARKER, GH);

    expect(r).toEqual({ number: 7, url: 'https://github.com/acme/web/issues/7', created: true, reopened: false });
    const [list, latest, create] = calls();
    expect(latest!.argv).not.toContain('--search');
    // Closed issues too, so a unit closed once and missed again is not filed twice.
    expect(list!.argv).toEqual(['issue', 'list', '-R', 'acme/web', '--state', 'all', '--search', `"${MARKER.trim()}" in:body`, '--json', 'number,url,body,state', '--limit', '20']);
    expect(create).toEqual({ argv: ['issue', 'create', '-R', 'acme/web', '--title', 'ctxlock: rule/.claude/rules/deps.md needs a look', '--body-file', '-'], stdin: body });
  });

  it('a second openIssue for the same marker edits that issue instead', async () => {
    scenario({ issues: [{ number: 3, url: 'https://github.com/acme/web/issues/3', body: 'unrelated' }, { number: 5, url: 'https://github.com/acme/web/issues/5', body: `${MARKER}sha256:0 -->\nold` }] });

    const r = await openIssue('acme/web', 'title', `${MARKER}sha256:1 -->\nnew`, MARKER, GH);

    expect(r).toEqual({ number: 5, url: 'https://github.com/acme/web/issues/5', created: false, reopened: false });
    expect(calls().map((c) => c.argv.slice(0, 3))).toEqual([['issue', 'list', '-R'], ['issue', 'edit', '5']]);
    expect(calls()[1]!.stdin).toBe(`${MARKER}sha256:1 -->\nnew`);
  });

  it("an issue that only quotes the marker is not taken for the unit's own", async () => {
    scenario({ issues: [{ number: 3, url: 'https://github.com/acme/web/issues/3', body: `See ${MARKER}sha256:0 -->` }, { number: 5, url: 'https://github.com/acme/web/issues/5', body: `${MARKER}sha256:0 -->\nold` }] });

    expect(await openIssue('acme/web', 'title', `${MARKER}sha256:1 -->\nnew`, MARKER, GH)).toMatchObject({ number: 5, created: false });
  });

  it('an issue search has not indexed yet is found among the latest issues, so a quick rerun files no second one', async () => {
    scenario({ searched: [], issues: [{ number: 9, url: 'https://github.com/acme/web/issues/9', body: `${MARKER}sha256:0 -->\nold` }] });

    const r = await openIssue('acme/web', 'title', `${MARKER}sha256:1 -->\nnew`, MARKER, GH);

    expect(r).toMatchObject({ number: 9, created: false });
    const [search, latest, edit] = calls();
    expect(search!.argv).toContain('--search');
    expect(latest!.argv).toEqual(['issue', 'list', '-R', 'acme/web', '--state', 'all', '--json', 'number,url,body,state', '--limit', '100']);
    expect(edit!.argv.slice(0, 3)).toEqual(['issue', 'edit', '9']);
  });

  it('a closed issue for the unit is updated and reopened, since the unit missed again; an open one is not reopened', async () => {
    scenario({ issues: [{ number: 5, url: 'https://github.com/acme/web/issues/5', state: 'CLOSED', body: `${MARKER}sha256:0 -->
old` }] });

    const r = await openIssue('acme/web', 'title', `${MARKER}sha256:1 -->
new`, MARKER, GH);

    expect(r).toEqual({ number: 5, url: 'https://github.com/acme/web/issues/5', created: false, reopened: true });
    expect(calls().map((c) => c.argv.slice(0, 5))).toEqual([['issue', 'list', '-R', 'acme/web', '--state'], ['issue', 'edit', '5', '-R', 'acme/web'], ['issue', 'reopen', '5', '-R', 'acme/web']]);

    scenario({ issues: [{ number: 6, url: 'https://github.com/acme/web/issues/6', state: 'OPEN', body: `${MARKER}sha256:0 -->
old` }] });
    expect(await openIssue('acme/web', 'title', `${MARKER}sha256:1 -->
new`, MARKER, GH)).toMatchObject({ number: 6, reopened: false });
    expect(calls().some((c) => c.argv[1] === 'reopen' && c.argv[2] === '6')).toBe(false);
  });

  it('a gh that fails is an IssueError naming the repository', async () => {
    scenario({ fail: true });

    await expect(openIssue('acme/web', 't', 'b', MARKER, GH)).rejects.toThrow(IssueError);
    await expect(openIssue('acme/web', 't', 'b', MARKER, GH)).rejects.toThrow(/gh issue list failed for acme\/web: To get started with GitHub CLI/);
  });
});
