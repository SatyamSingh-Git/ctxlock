import { createHash } from 'node:crypto';
import type { UnitFile } from '../model.js';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function unitDigest(files: UnitFile[]): string {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\0${f.sha256}\n`)
    .join('');
  return `sha256:${sha256Hex(lines)}`;
}
