import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lfDigest } from '../units/digest.js';
import { GENERATED_FILE, type GeneratedFile, serializeGenerated } from './generated.js';
import { BuildError } from './index-suggest.js';
import type { FillPlan } from './plan.js';

// Whether a part of the path, from the repository's top down, is a symlink or a Windows junction. The
// plan saw only what git lists, and git lists no link it ignores.
function linked(top: string, path: string): boolean {
  let at = top;
  for (const part of path.split('/')) {
    at = join(at, part);
    if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) return true;
  }
  return false;
}

// Writes each planned file inside the repository, where nothing is yet or where ctxlock's own output
// is unedited, checked again here since the plan was made; then records what it generated.
export async function applyFill(top: string, plan: FillPlan, previous: GeneratedFile[]): Promise<{ written: string[]; removed: string[]; refused: string[] }> {
  if (linked(top, GENERATED_FILE)) throw new BuildError(`${GENERATED_FILE} is reached through a link; ctxlock writes through none`);
  const recorded = new Map(previous.map((g) => [g.path, g]));
  const entries = new Map(recorded);
  const written: string[] = [];
  const removed: string[] = [];
  const refused: string[] = [];
  for (const file of plan.actions.flatMap((a) => a.files)) {
    const full = resolve(top, file.path);
    const rel = relative(top, full);
    const now = existsSync(full) ? readFileSync(full) : null;
    const outside = rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (outside || linked(top, file.path) || (now !== null && recorded.get(file.path)?.sha256 !== lfDigest(now))) {
      refused.push(file.path);
      continue;
    }
    // A checkout may have changed the line endings of a file that is otherwise what would be written.
    if (now === null || lfDigest(now) !== lfDigest(file.bytes)) {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.bytes);
      written.push(file.path);
    }
    entries.set(file.path, { path: file.path, sha256: lfDigest(file.bytes), from: file.from });
  }
  for (const path of plan.actions.flatMap((a) => a.remove ?? [])) {
    const full = resolve(top, path);
    const now = existsSync(full) ? readFileSync(full) : null;
    if (linked(top, path) || (now !== null && recorded.get(path)?.sha256 !== lfDigest(now))) {
      refused.push(path);
      continue;
    }
    if (now !== null) {
      rmSync(full);
      removed.push(path);
    }
    entries.delete(path);
  }

  // No record is started for a fill that generated nothing.
  const recordPath = join(top, GENERATED_FILE);
  if (entries.size > 0) {
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, serializeGenerated([...entries.values()]));
  }
  return { written: written.sort(), removed: removed.sort(), refused: refused.sort() };
}
