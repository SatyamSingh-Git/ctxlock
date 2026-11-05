import { posix } from 'node:path';
import { findImports } from '../../harness/imports.js';
import type { Finding, Unit } from '../../model.js';
import { inlineCode } from '../../units/markdown.js';
import { lineAndColumn } from '../files.js';
import type { Rule } from '../types.js';

const PATH_LIKE = /^(\.{0,2}\/)?[\w.-]+(\/[\w.-]+)+\/?$/;
const FILE_LIKE = /\.(md|ts|js|py|json|yaml|yml|toml|sh|go|rs)$/;
const NOT_A_PATH = /[*?{}<>$\s]|^http/;
// [ \t] rather than \s, so a command at the end of a line never takes its script name from the next line.
const SCRIPT = /\b(?:npm[ \t]+run[ \t]+([\w:.-]+)|npm[ \t]+(test)\b|(?:pnpm|yarn)[ \t]+(?:run[ \t]+)?([\w:.-]+))/g;
// npm, pnpm and yarn commands that are not package.json scripts.
const BUILTINS = new Set(
  'install i add remove exec dlx create init why up update outdated publish link audit run workspace workspaces list ls info config cache store env prune rebuild dedupe unlink pack login logout version set help upgrade import patch node'.split(
    ' ',
  ),
);

const folder = (unit: Unit) => {
  const dir = unit.kind === 'skill' ? unit.path : posix.dirname(unit.path);
  return dir === '.' ? '' : dir;
};
const inRepo = (path: string) => path !== '..' && !path.startsWith('../');

export const staleReferences: Rule = {
  id: 'L9-stale',
  async check({ reader, units, registry, today }) {
    const findings: Finding[] = [];
    const links = [...(await reader.listSymlinks()).keys()];
    const present = async (path: string) => (await reader.exists(path)) || links.some((l) => path === l || path.startsWith(`${l}/`));
    const scripts = new Map<string, Set<string> | null>();

    async function nearestScripts(dir: string): Promise<{ file: string; names: Set<string> } | null> {
      for (let d = dir; ; d = posix.dirname(d) === '.' ? '' : posix.dirname(d)) {
        const file = d ? `${d}/package.json` : 'package.json';
        if (await present(file)) {
          if (!scripts.has(file)) {
            // A package.json that does not parse says nothing about its scripts, so they are not checked.
            let names: Set<string> | null = null;
            try {
              const json = JSON.parse((await reader.readFile(file)).toString('utf8')) as { scripts?: Record<string, unknown> };
              names = new Set(Object.keys(json.scripts ?? {}));
            } catch {}
            scripts.set(file, names);
          }
          const names = scripts.get(file);
          return names ? { file, names } : null;
        }
        if (d === '') return null;
      }
    }

    for (const unit of units) {
      if (unit.kind === 'config') continue;
      const dir = folder(unit);
      const path = unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path;
      const report = (rule: string, severity: Finding['severity'], message: string, at?: { line: number; column: number }) =>
        findings.push({ rule, severity, message, path, ...at, unitId: unit.id });

      for (const { code: token, offset } of inlineCode(unit.text)) {
        if (NOT_A_PATH.test(token) || !(PATH_LIKE.test(token) || FILE_LIKE.test(token))) continue;
        const candidates = (token.startsWith('/') ? [token.slice(1)] : [posix.join(dir, token), token]).map((p) => posix.normalize(p).replace(/\/$/, ''));
        // A path that leads out of the repository cannot be checked.
        const checkable = candidates.filter(inRepo);
        if (checkable.length === 0) continue;
        let found = false;
        for (const candidate of checkable) found ||= await present(candidate);
        if (found) continue;
        const at = lineAndColumn(unit.text, offset);
        report('L9-stale', 'should', `${token} at ${at.line}:${at.column} does not exist`, at);
      }

      for (const match of unit.text.matchAll(SCRIPT)) {
        const name = match[1] ?? match[2] ?? match[3]!;
        if (name.startsWith('-') || BUILTINS.has(name)) continue;
        const pkg = await nearestScripts(dir);
        if (!pkg || pkg.names.has(name)) continue;
        const at = lineAndColumn(unit.text, match.index);
        report('L9-stale', 'should', `${match[0].replace(/[ \t]+/g, ' ')} at ${at.line}:${at.column}: ${pkg.file} has no "${name}" script`, at);
      }

      const due = registry.units[unit.path]?.staleAfter;
      if (due !== undefined && due < today) report('L9-stale', 'should', `${unit.path} was due for review by ${due} (stale-after in ctxlock.yaml)`);

      // Claude Code resolves imports in instructions and rules, relative to the importing file.
      if (unit.kind !== 'instructions' && unit.kind !== 'rule') continue;
      for (const target of findImports(unit.text)) {
        if (!target.endsWith('.md') || target.startsWith('~/') || posix.isAbsolute(target)) continue;
        const resolved = posix.normalize(posix.join(posix.dirname(unit.path), target));
        if (inRepo(resolved) && !(await present(resolved))) report('L9-import-missing', 'info', `@${target}: ${resolved} does not exist`);
      }
    }
    return findings;
  },
};
