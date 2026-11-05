import ignore from 'ignore';
import type { Unit } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import type { Registry } from './registry.js';

export interface Codeowners {
  present: boolean;
  ownersOf(path: string): string[];
}

const LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

export async function loadCodeowners(reader: RepoReader): Promise<Codeowners> {
  for (const location of LOCATIONS) {
    if (!(await reader.exists(location))) continue;

    const rules = (await reader.readFile(location))
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s#.*$/, '').trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [pattern, ...owners] = line.split(/\s+/);
        // One matcher per line, because CODEOWNERS is "last match wins" rather than gitignore's union.
        // GitHub matches case-sensitively, and a trailing /* stops at one level where gitignore recurses.
        const matcher = ignore({ ignorecase: false }).add(pattern!.endsWith('/*') ? [pattern!, `!${pattern}/`] : pattern!);
        return { matches: (path: string) => matcher.ignores(path), owners };
      });

    return {
      present: true,
      ownersOf(path) {
        let owners: string[] = [];
        for (const rule of rules) if (rule.matches(path)) owners = rule.owners;
        return owners;
      },
    };
  }
  return { present: false, ownersOf: () => [] };
}

export function unitOwners(unit: Unit, registry: Registry, codeowners: Codeowners): string[] {
  const owner = registry.units[unit.path]?.owner;
  if (owner) return [owner];
  // A skill is a directory; CODEOWNERS directory patterns match the files inside it.
  return codeowners.ownersOf(unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path);
}
