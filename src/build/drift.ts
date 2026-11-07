import { posix } from 'node:path';
import { ownerDir } from '../harness/claude-code.js';
import { findImports } from '../harness/imports.js';
import { home } from '../lint/rules/l13-shadowed.js';
import type { Unit } from '../model.js';
import type { ScanResult } from '../scan.js';
import { throughLink } from './plan.js';

// Two files written by hand that serve the same folder for different agents, and say different things.
export interface Drift {
  paths: [string, string];
  summary: string;
}

const lines = (text: string) => new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
const relative = (unit: Unit) => new Map(unit.files.map((f) => [f.path.slice(unit.path.length + 1), f.sha256]));

export function findDrift(scan: ScanResult): Drift[] {
  const outputs = new Set(scan.generated.files.map((g) => g.path));
  const handMade = scan.units.filter((u) => !u.files.some((f) => outputs.has(f.path)));
  const found: Drift[] = [];

  const skills = handMade.filter((u) => u.kind === 'skill' && !throughLink(u));
  for (const agents of skills.filter((u) => ownerDir(u.path, '.agents/skills') !== null)) {
    const claude = skills.find((u) => u.path === agents.path.replace(/(^|\/)\.agents\/skills\//, '$1.claude/skills/'));
    if (!claude) continue;
    const [a, c] = [relative(agents), relative(claude)];
    const differ = [...new Set([...a.keys(), ...c.keys()])].filter((p) => a.get(p) !== c.get(p)).sort();
    if (differ.length > 0) found.push({ paths: [agents.path, claude.path], summary: `the copies differ: ${differ.join(', ')}` });
  }

  // CLAUDE.md or .claude/CLAUDE.md; a personal CLAUDE.local.md is never one of a pair.
  for (const claude of handMade.filter((u) => u.kind === 'instructions' && posix.basename(u.path) === 'CLAUDE.md')) {
    const folder = home(claude.path);
    const agentsPath = folder ? `${folder}/AGENTS.md` : 'AGENTS.md';
    const agents = handMade.find((u) => u.path === agentsPath);
    if (!agents) continue;
    const imported = findImports(claude.text).some((i) => posix.normalize(posix.join(posix.dirname(claude.path), i)) === agentsPath);
    if (imported) continue;
    const [c, a] = [lines(claude.text), lines(agents.text)];
    const onlyClaude = [...c].filter((l) => !a.has(l)).length;
    const onlyAgents = [...a].filter((l) => !c.has(l)).length;
    if (onlyClaude + onlyAgents === 0) continue;
    const name = (p: string) => posix.basename(p);
    found.push({
      paths: [claude.path, agentsPath],
      summary: `${onlyClaude} line${onlyClaude === 1 ? '' : 's'} only in ${name(claude.path)}, ${onlyAgents} only in ${name(agentsPath)}`,
    });
  }
  return found;
}
