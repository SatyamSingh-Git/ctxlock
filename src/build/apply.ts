import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lfDigest } from '../units/digest.js';
import { GENERATED_FILE, type GeneratedFile, serializeGenerated } from './generated.js';
import type { FillPlan } from './plan.js';

// Writes each planned file inside the repository, where nothing is yet or where ctxlock's own output
// is unedited, checked again here since the plan was made; then records what it generated.
export async function applyFill(top: string, plan: FillPlan, previous: GeneratedFile[]): Promise<{ written: string[]; refused: string[] }> {
  const recorded = new Map(previous.map((g) => [g.path, g]));
  const entries = new Map(recorded);
  const written: string[] = [];
  const refused: string[] = [];
  for (const file of plan.actions.flatMap((a) => a.files)) {
    const full = resolve(top, file.path);
    const rel = relative(top, full);
    const now = existsSync(full) ? readFileSync(full) : null;
    const outside = rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (outside || (now !== null && recorded.get(file.path)?.sha256 !== lfDigest(now))) {
      refused.push(file.path);
      continue;
    }
    if (now === null || !now.equals(file.bytes)) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.bytes);
      written.push(file.path);
    }
    entries.set(file.path, { path: file.path, sha256: lfDigest(file.bytes), from: file.from });
  }

  // No record is started for a fill that generated nothing.
  const recordPath = join(top, GENERATED_FILE);
  if (entries.size > 0) {
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, serializeGenerated([...entries.values()]));
  }
  return { written: written.sort(), refused: refused.sort() };
}
