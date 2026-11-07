import { createHash } from 'node:crypto';
import type { UnitFile } from '../model.js';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// Hashed with CRLF read as LF, so a core.autocrlf checkout and its git ref agree on a file's identity.
// A file's bytes stay raw elsewhere, because that is what an agent reads from disk.
export const lfDigest = (buf: Buffer) => sha256Hex(buf.includes(0x0d) ? Buffer.from(buf.toString('latin1').replaceAll('\r\n', '\n'), 'latin1') : buf);

export function unitDigest(files: UnitFile[]): string {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\0${f.sha256}\n`)
    .join('');
  return `sha256:${sha256Hex(lines)}`;
}
