import { describe, expect, it } from 'vitest';
import { redact } from '../../src/loop/redact.js';

// Built here, so no token-shaped string sits in the repository.
const run = (n: number) => 'Ab1'.repeat(Math.ceil(n / 3)).slice(0, n);
const TOKENS = [
  `ghp_${run(36)}`,
  `gho_${run(36)}`,
  `github_pat_${run(40)}`,
  `sk-ant-api03-${run(40)}`,
  `sk-proj-${run(40)}`,
  `xoxb-${run(24)}`,
  `AKIA${'ABCDEFGH23456789'}`,
  `eyJ${run(20)}.eyJ${run(20)}.${run(20)}`,
];

describe('redact', () => {
  it('replaces each token shape, an email, a URL\'s credentials and query, and a home path, and leaves ordinary words and short hex alone', () => {
    for (const token of TOKENS) expect(redact(`use ${token} for it`), token).toBe('use <token> for it');
    const key = ['-----BEGIN OPENSSH PRIVATE KEY-----', run(60), '-----END OPENSSH PRIVATE KEY-----'].join('\n');
    expect(redact(`key:\n${key}\ndone`)).toBe('key:\n<token>\ndone');

    expect(redact('mail satyam@example.com now')).toBe('mail <email> now');
    expect(redact('clone https://user:secret@github.com/acme/web.git?token=abc#x')).toBe('clone https://github.com/acme/web.git');
    expect(redact('open C:\\Users\\satyam\\src\\acme\\notes.md please')).toBe('open <path>/notes.md please');
    expect(redact('see /home/satyam/acme/notes.md and /Users/sam/x.txt')).toBe('see <path>/notes.md and <path>/x.txt');
    expect(redact(`a blob ${run(32)}5 here`)).toBe('a blob <redacted> here');

    const plain = 'no, use pnpm test in packages/web/src/components/header/index.tsx at a1b2c3d, internationalization, pneumonoultramicroscopicsilicovolcanoconiosis';
    expect(redact(plain)).toBe(plain);
  });
});
