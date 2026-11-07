import type { Registry } from '../registry/registry.js';
import { overlayReader } from '../repo/overlay.js';
import type { RepoReader } from '../repo/reader.js';
import { type ScanResult, scanRepo } from '../scan.js';
import type { FillAction, FillPlan } from './plan.js';

const scanWith = (reader: RepoReader, actions: FillAction[], settings: Pick<Registry, 'harnesses' | 'limits' | 'lint'>) =>
  scanRepo(overlayReader(reader, new Map(actions.flatMap((a) => a.files.map((f) => [f.path, f.bytes] as const)))), { settings });

// Scans the repository as it would be after the fill, and drops each action whose file an agent
// would load only in part, or that would make an agent load only part of a file it loads in full
// today: a generated file that gets cut helps no one, and one that cuts a person's file costs them.
export async function previewFill(reader: RepoReader, plan: FillPlan, before: ScanResult): Promise<{ plan: FillPlan; after: ScanResult }> {
  const cutBefore = new Set(before.contexts.flatMap((ctx) => ctx.entries.filter((e) => e.loadedBytes < e.bytes).map((e) => `${ctx.harness} ${ctx.site} ${e.path}`)));
  const cut = new Map<string, string>();
  let actions = plan.actions;
  let after = await scanWith(reader, actions, before.registry);
  for (;;) {
    const targetOf = new Map(actions.flatMap((a) => a.files.map((f) => [f.path, a.target] as const)));
    const size = cut.size;
    for (const ctx of after.contexts) {
      // Only the first cut a fill causes in a chain is its doing: what comes after may be cut only
      // because of it, and fits once that fill is dropped. A skill's entry names its folder, never a
      // planned file, and a file Codex drops from its chain has loadedBytes 0.
      for (const [i, e] of ctx.entries.entries()) {
        if (e.loadedBytes >= e.bytes) continue;
        const note = ctx.notes.find((n) => n.includes(` ${e.path} `)) ?? `${ctx.harness} would load only part of ${e.path}`;
        const target = targetOf.get(e.path);
        if (target) {
          if (!cut.has(target)) cut.set(target, `would be cut: ${note}`);
          break;
        }
        if (cutBefore.has(`${ctx.harness} ${ctx.site} ${e.path}`)) continue;
        const ahead = ctx.entries.slice(0, i).flatMap((a) => targetOf.get(a.path) ?? []);
        for (const t of ahead) if (!cut.has(t)) cut.set(t, `would cut ${e.path}: ${note}`);
        if (ahead.length > 0) break;
      }
    }
    if (cut.size === size) break;
    actions = actions.filter((a) => !cut.has(a.target));
    after = await scanWith(reader, actions, before.registry);
  }
  const gaps = plan.gaps.map((g) => (g.fill !== null && cut.has(g.fill) ? { ...g, fill: null, reason: cut.get(g.fill)! } : g));
  return { plan: { actions, gaps }, after };
}
