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

describe('redact, the shapes the final review found', () => {
  it('a path whose folders have spaces loses every folder, on Windows, macOS, WSL and a share', () => {
    expect(redact('no, open C:\\Users\\Satyam Singh\\Documents\\notes.txt now')).toBe('no, open <path>/notes.txt now');
    expect(redact('C:\\Users\\satyam\\OneDrive - Acme Corp\\Clients\\BigBank merger\\plan.docx')).toBe('<path>/plan.docx');
    expect(redact('see /Users/Jane Doe/work/a.md')).toBe('see <path>/a.md');
    expect(redact('in /mnt/c/Users/satyam/acme/notes.md')).toBe('in <path>/notes.md');
    expect(redact('from \\\\server\\home\\satyam\\acme\\notes.md')).toBe('from <path>/notes.md');
  });

  it('a secret after a word that names it, a Slack webhook, a GitLab token and a cut-short private key are replaced', () => {
    expect(redact(`no, the secret is ${'wJalrXUtnFEMI/K7MDENG/bPxRfiCY'}EXAMPLEKEY`)).toBe('no, the secret is <token>');
    expect(redact(`aws_secret_access_key = ${'Zx9/aB3+kLmN0pQrStUv/WxYz'}12345abcdEFGH`)).toBe('aws_secret_access_key = <token>');
    expect(redact('password: hunter2hunter2')).toBe('password: <token>');
    expect(redact(`post to https://hooks.slack.com/services/T0ABC1234/B0ABC5678/${run(24)} now`)).toBe('post to <token> now');
    expect(redact(`use glpat-${run(20)} here`)).toBe('use <token> here');
    expect(redact(`key: -----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn/NzaC1r/ZXktd`)).toBe('key: <token>');
    // The words alone are no secret.
    expect(redact('no, the token is in the env file and the password field is empty')).toBe('no, the token is in the env file and the password field is empty');
    expect(redact('fix the token expiration setting')).toBe('fix the token expiration setting');
  });
});

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

    const plain2 = 'and keep packages/web/src/v2/components/HeaderLayout/AppShell.tsx as it is';
    expect(redact(plain2)).toBe(plain2);

    const plain ='no, use pnpm test in packages/web/src/components/header/index.tsx at a1b2c3d, internationalization, pneumonoultramicroscopicsilicovolcanoconiosis';
    expect(redact(plain)).toBe(plain);
  });
});
