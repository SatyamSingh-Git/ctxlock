import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lfDigest } from '../units/digest.js';
import { GENERATED_FILE, type GeneratedFile, serializeGenerated } from './generated.js';
import { BuildError } from './index-suggest.js';
import type { FillPlan } from './plan.js';

// Whether a part of the path, from the repository's top down, is a symlink or a Windows junction. The
// plan saw only what git lists, and git lists no link it ignores.
export function linked(top: string, path: string): boolean {
  let at = top;
  for (const part of path.split('/')) {
    at = join(at, part);
    if (lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) return true;
  }
  return false;
}

// Whether a path, given from the repository's top, lands outside it.
export function outsideRepo(top: string, path: string): boolean {
  const rel = relative(top, resolve(top, path));
  return rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
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
  const at = (path: string) => {
    const full = resolve(top, path);
    return { path, full, now: existsSync(full) ? readFileSync(full) : null };
  };
  // ctxlock may change a path inside the repository, reached through no link, that holds nothing or
  // its own unedited output.
  const mine = ({ path, now }: ReturnType<typeof at>) => {
    return !outsideRepo(top, path) && !linked(top, path) && (now === null || recorded.get(path)?.sha256 === lfDigest(now));
  };
  try {
    for (const action of plan.actions) {
      const writes = action.files.map((file) => ({ ...at(file.path), file }));
      const removes = (action.remove ?? []).map(at);
      // An action is written whole or not at all. On a case-insensitive file system a person's folder
      // can stand at a planned path that differs only in case, and only some of its files collide.
      const taken = [...writes, ...removes].filter((p) => !mine(p));
      if (taken.length > 0) {
        refused.push(...taken.map((p) => p.path));
        continue;
      }
      for (const { file, full, now } of writes) {
        // A checkout may have changed the line endings of a file that is otherwise what would be written.
        if (now === null || lfDigest(now) !== lfDigest(file.bytes)) {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, file.bytes);
          written.push(file.path);
        }
        entries.set(file.path, { path: file.path, sha256: lfDigest(file.bytes), from: file.from });
      }
      for (const { path, full, now } of removes) {
        if (now !== null) {
          rmSync(full);
          removed.push(path);
        }
        entries.delete(path);
      }
    }
  } finally {
    // Written even when a write fails partway, so files already written are never taken for a person's;
    // and when the last entry goes, so the record names no file that is gone. But no record is started
    // for a fill that generated nothing.
    const recordPath = join(top, GENERATED_FILE);
    if (entries.size > 0 || recorded.size > 0) {
      mkdirSync(dirname(recordPath), { recursive: true });
      writeFileSync(recordPath, serializeGenerated([...entries.values()]));
    }
  }
  return { written: written.sort(), removed: removed.sort(), refused: refused.sort() };
}
