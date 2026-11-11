// What a person typed, made safe to hand to someone else (§7). Token shapes follow the prefixes
// gitleaks' rules use (MIT).
const TOKENS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];
const URLS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'`<>|]+\\)*([^\\\s"'`<>|]+)/g;
const HOME_PATH = /(?<![\w.~])\/(?:home|Users|root)\/(?:[^/\s"'`<>]+\/)*([^/\s"'`<>]+)/g;
// A long run with a digit in it: a key or a hash. A long word has none.
const BLOB = /(?=[A-Za-z0-9+=_-]*\d)[A-Za-z0-9+=_-]{32,}/g;

// A URL keeps its host and path; only one that carries credentials, a query or a fragment is rewritten,
// so the rest stay as typed.
function bareUrl(text: string): string {
  if (!URL.canParse(text)) return text;
  const url = new URL(text);
  if (!url.username && !url.password && !url.search && !url.hash) return text;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

export function redact(text: string): string {
  let out = text;
  for (const token of TOKENS) out = out.replace(token, '<token>');
  return out
    .replace(URLS, bareUrl)
    .replace(EMAIL, '<email>')
    .replace(WINDOWS_PATH, '<path>/$1')
    .replace(HOME_PATH, '<path>/$1')
    .replace(BLOB, '<redacted>');
}
