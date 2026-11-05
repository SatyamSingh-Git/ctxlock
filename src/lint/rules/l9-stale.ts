import { posix } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { findImports } from '../../harness/imports.js';
import type { Finding, Unit } from '../../model.js';
import { codeOnly, inlineCode } from '../../units/markdown.js';
import { lineAndColumn, readOnce } from '../files.js';
import type { Rule } from '../types.js';

const PATH_LIKE = /^(\.{0,2}\/)?[\w.-]+(\/[\w.-]+)+\/?$/;
// A name before the extension is required: `.json` alone names a format.
const FILE_LIKE = /[^/]\.(md|ts|js|py|json|yaml|yml|toml|sh|go|rs)$/;
const NOT_A_PATH = /[*?{}<>$\s]|^http/;
const PLACEHOLDER = /(?:^|\/)(?:foo|bar|baz|qux|(?:my|your)[-_][\w.-]*)(?:\.\w+)?(?:\/|$)/i;
const SKILL_FOLDERS = new Set(['scripts', 'references', 'assets']);
// Only forms that always mean a script: bare `pnpm X` and `yarn X` also run a dependency's binary
// when no script has that name. [ \t] rather than \s, so a script name never comes from the next line.
const SCRIPT = /\b(?:(?:npm|pnpm|yarn)[ \t]+run[ \t]+([\w:.-]+)|(?:npm|pnpm|yarn)[ \t]+(test)\b)/g;

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
    const paths = new Set([...(await reader.listFiles()), ...links]);
    const dirs = new Set<string>();
    for (const p of paths) for (let d = posix.dirname(p); d !== '.'; d = posix.dirname(d)) dirs.add(d);
    const names = new Set([...paths, ...dirs].map((p) => posix.basename(p)));
    const present = (path: string) =>
      path === '.' || path === '' || paths.has(path) || dirs.has(path) || links.some((l) => path.startsWith(`${l}/`));
    const scripts = new Map<string, Set<string> | null>();
    const gitignores = new Map<string, Ignore>();

    // Build outputs, logs and caches are referenced on purpose and exist only once something runs.
    async function ignored(path: string): Promise<boolean> {
      for (let d = posix.dirname(path); ; d = posix.dirname(d)) {
        const base = d === '.' ? '' : d;
        const file = base ? `${base}/.gitignore` : '.gitignore';
        if (paths.has(file)) {
          if (!gitignores.has(file)) gitignores.set(file, ignore().add((await readOnce(reader, file)).toString('utf8')));
          if (gitignores.get(file)!.ignores(base ? path.slice(base.length + 1) : path)) return true;
        }
        if (base === '') return false;
      }
    }

    async function nearestScripts(dir: string): Promise<{ file: string; names: Set<string> } | null> {
      for (let d = dir; ; d = posix.dirname(d) === '.' ? '' : posix.dirname(d)) {
        const file = d ? `${d}/package.json` : 'package.json';
        if (present(file)) {
          if (!scripts.has(file)) {
            const text = (await readOnce(reader, file)).toString('utf8');
            // A package.json that does not parse says nothing about its scripts, so they are not checked.
            let json: { scripts?: Record<string, unknown> } | null = null;
            try {
              json = JSON.parse(text) as { scripts?: Record<string, unknown> };
            } catch {}
            scripts.set(file, json ? new Set(Object.keys(json.scripts ?? {})) : null);
          }
          const found = scripts.get(file);
          return found ? { file, names: found } : null;
        }
        if (d === '') return null;
      }
    }

    // A path is checked only where its first folder exists, from the unit's folder or the root:
    // `origin/main`, `application/json` and `/etc/hosts` name no folder in the repository. A skill's
    // own scripts/, references/ and assets/ (the Agent Skills layout) are checked even when missing.
    async function missing(token: string, unit: Unit, dir: string): Promise<boolean> {
      const relative = token.replace(/^\//, '').replace(/\/$/, '');
      // A bare file name, often an example, counts as present if any file in the repository has it.
      if (!relative.includes('/')) return !names.has(relative);
      const first = relative.split('/')[0]!;
      const own = unit.kind === 'skill' && SKILL_FOLDERS.has(first);
      const bases = token.startsWith('/') ? [''] : [...new Set([dir, ''])];
      const checkable = bases
        .filter((base) => {
          if (own && base === dir) return true;
          const anchor = posix.normalize(posix.join(base, first));
          return inRepo(anchor) && present(anchor);
        })
        .map((base) => posix.normalize(posix.join(base, relative)))
        .filter(inRepo);
      if (checkable.length === 0 || checkable.some(present)) return false;
      // In a monorepo `src/ast/utils.ts` often means the one in some package's folder. A skill's own folders are its own.
      if (!own && [...paths, ...dirs].some((p) => p.endsWith(`/${relative}`))) return false;
      for (const path of checkable) if (await ignored(path)) return false;
      return true;
    }

    for (const unit of units) {
      if (unit.kind === 'config') continue;
      const dir = folder(unit);
      const path = unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path;
      const report = (rule: string, severity: Finding['severity'], message: string, at?: { line: number; column: number }) =>
        findings.push({ rule, severity, message, path, ...at, unitId: unit.id });

      for (const { code: token, offset } of inlineCode(unit.text)) {
        if (NOT_A_PATH.test(token) || PLACEHOLDER.test(token) || !(PATH_LIKE.test(token) || FILE_LIKE.test(token))) continue;
        if (!(await missing(token, unit, dir))) continue;
        const at = lineAndColumn(unit.text, offset);
        report('L9-stale', 'should', `${token} at ${at.line}:${at.column} does not exist`, at);
      }

      // Commands are read from code only: "we use pnpm instead of npm" is not one.
      for (const match of codeOnly(unit.text).matchAll(SCRIPT)) {
        const name = match[1] ?? match[2]!;
        if (name.startsWith('-')) continue;
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
        if (inRepo(resolved) && !present(resolved)) report('L9-import-missing', 'info', `@${target}: ${resolved} does not exist`);
      }
    }
    return findings;
  },
};
