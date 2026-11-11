// What a person typed, made safe to hand to someone else (§7). Token shapes follow the prefixes
// gitleaks' rules use (MIT).
const TOKENS = [
  // A correction's words are cut short, so a key may have no END line.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];
// A value after a word that names it, as gitleaks' generic rule reads one: an AWS secret key has no
// shape of its own.
const KEYED = /\b(aws_secret_access_key|secret_access_key|secret|password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|token)(\s*[:=]\s*|\s+is\s+)(["']?)[^\s"']{8,}/gi;
const URLS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A folder can hold spaces, so every part up to the last separator goes, and only the last part, which
// ends at a space, stays. A part stops where another absolute path begins, so two paths in one sentence
// stay two.
const PART = String.raw`(?:(?! (?:[A-Za-z]:)?[\\/])[^\\/\n"'\x60<>|])*`;
const WINDOWS_PATH = new RegExp(String.raw`\b[A-Za-z]:[\\/](?:${PART}[\\/])*([^\\/\s"'\x60<>|]+)`, 'g');
const SHARE_PATH = new RegExp(String.raw`\\\\(?:${PART}\\)+([^\\\s"'\x60<>|]+)`, 'g');
const HOME_PATH = new RegExp(String.raw`(?<![\w.~])(?:/mnt/[a-z])?/(?:home|Users|root)/(?:${PART}/)*([^/\s"'\x60<>]+)`, 'g');
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
    .replace(KEYED, '$1$2$3<token>')
    .replace(URLS, bareUrl)
    .replace(EMAIL, '<email>')
    .replace(SHARE_PATH, '<path>/$1')
    .replace(WINDOWS_PATH, '<path>/$1')
    .replace(HOME_PATH, '<path>/$1')
    .replace(BLOB, '<redacted>');
}
