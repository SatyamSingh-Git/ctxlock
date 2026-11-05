import { posix } from 'node:path';
import type { EffectiveContext } from '../../harness/types.js';
import type { Rule } from '../types.js';

// Each AGENTS.md that Codex loads at some site while Claude Code, at the same site, does not, because
// a CLAUDE file there takes its place. Paired with the CLAUDE file that should import it: the deepest
// one at the site where the AGENTS.md is first seen, which is the AGENTS.md's own folder.
export function shadowed(contexts: EffectiveContext[]): Array<{ path: string; unitId: string; claudeFile: string }> {
  const found = new Map<string, { path: string; unitId: string; claudeFile: string }>();
  for (const codex of contexts) {
    if (codex.harness !== 'codex') continue;
    const claude = contexts.find((c) => c.harness === 'claude-code' && c.site === codex.site);
    if (!claude) continue;
    const loaded = new Set(claude.entries.map((e) => e.unitId));
    const claudeFiles = claude.entries.filter((e) => e.reason === 'ancestor').map((e) => e.path);
    // CLAUDE.local.md is personal and usually gitignored, so it is suggested only when it is the only one.
    const shared = claudeFiles.filter((p) => posix.basename(p) !== 'CLAUDE.local.md');
    const claudeFile = (shared.length > 0 ? shared : claudeFiles).at(-1);
    // No CLAUDE file means Claude Code fell back to AGENTS.md, and skipped this one for another reason.
    if (!claudeFile) continue;
    for (const entry of codex.entries) {
      if (posix.basename(entry.path) !== 'AGENTS.md' || loaded.has(entry.unitId) || found.has(entry.path)) continue;
      found.set(entry.path, { path: entry.path, unitId: entry.unitId, claudeFile });
    }
  }
  return [...found.values()];
}

export const shadowedAgentsMd: Rule = {
  id: 'L13-agents-md-shadowed',
  check({ contexts }) {
    return shadowed(contexts).map(({ path, unitId, claudeFile }) => ({
      rule: 'L13-agents-md-shadowed',
      severity: 'should',
      message: `Claude Code ignores ${path} because ${claudeFile} exists; add @${posix.relative(posix.dirname(claudeFile), path)} to ${claudeFile}`,
      path,
      unitId,
    }));
  },
};
