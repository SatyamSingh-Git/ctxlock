import { posix } from 'node:path';
import type { GeneratedFile } from '../../build/generated.js';
import type { EffectiveContext } from '../../harness/types.js';
import type { Rule } from '../types.js';

// The folder a CLAUDE file speaks for: .claude/CLAUDE.md belongs to the folder above .claude.
export const home = (path: string) => {
  const dir = posix.dirname(path).replace(/(^|\/)\.claude$/, '');
  return dir === '.' ? '' : dir;
};

interface Shadowed {
  path: string;
  unitId: string;
  // The CLAUDE file whose presence makes Claude Code skip AGENTS.md.
  blocker: string;
  fix: string;
}

// Each AGENTS.md that Codex loads at some site while Claude Code, at the same site, does not, because a
// CLAUDE file takes its place. It is first seen at its own folder's site, so that is where the fix is
// chosen: an import from a shared CLAUDE file in the same folder, or else a new CLAUDE.md there. An
// import higher up would load the file at every site, while Codex loads it only under its folder.
// An AGENTS.md that ctxlock build generated is left out: Claude Code reads its sources already.
export function shadowed(contexts: EffectiveContext[], generated: GeneratedFile[] = []): Shadowed[] {
  const outputs = new Set(generated.map((g) => g.path));
  const found = new Map<string, Shadowed>();
  for (const codex of contexts) {
    if (codex.harness !== 'codex') continue;
    const claude = contexts.find((c) => c.harness === 'claude-code' && c.site === codex.site);
    if (!claude) continue;
    const loaded = new Set(claude.entries.map((e) => e.unitId));
    const claudeFiles = claude.entries.filter((e) => e.reason === 'ancestor').map((e) => e.path);
    // CLAUDE.local.md is personal and usually gitignored, so it is never where the import goes.
    const shared = claudeFiles.filter((p) => posix.basename(p) !== 'CLAUDE.local.md');
    const blocker = (shared.length > 0 ? shared : claudeFiles).at(-1);
    // No CLAUDE file means Claude Code fell back to AGENTS.md, and skipped this one for another reason.
    if (!blocker) continue;
    for (const entry of codex.entries) {
      if (posix.basename(entry.path) !== 'AGENTS.md' || loaded.has(entry.unitId) || found.has(entry.path) || outputs.has(entry.path)) continue;
      const dir = home(entry.path);
      const target = shared.find((p) => home(p) === dir);
      const fix = target
        ? `add @${posix.relative(posix.dirname(target), entry.path)} to ${target}`
        : `create ${dir ? `${dir}/` : ''}CLAUDE.md containing @AGENTS.md`;
      found.set(entry.path, { path: entry.path, unitId: entry.unitId, blocker, fix });
    }
  }
  return [...found.values()];
}

export const shadowedAgentsMd: Rule = {
  id: 'L13-agents-md-shadowed',
  check({ contexts, generated }) {
    return shadowed(contexts, generated).map(({ path, unitId, blocker, fix }) => ({
      rule: 'L13-agents-md-shadowed',
      severity: 'should',
      message: `Claude Code ignores ${path} because ${blocker} exists; ${fix}`,
      path,
      unitId,
    }));
  },
};
