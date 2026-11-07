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
  const after = await scanWith(reader, plan.actions, before.registry);
  const targetOf = new Map(plan.actions.flatMap((a) => a.files.map((f) => [f.path, a.target] as const)));
  const cutBefore = new Set(before.contexts.flatMap((ctx) => ctx.entries.filter((e) => e.loadedBytes < e.bytes).map((e) => `${ctx.harness} ${ctx.site} ${e.path}`)));
  const cut = new Map<string, string>();
  for (const ctx of after.contexts) {
    ctx.entries.forEach((e, i) => {
      // A skill's entry names its folder, never a planned file, so a listed skill is never taken for a
      // cut file. A file Codex drops from its chain has loadedBytes 0.
      if (e.loadedBytes >= e.bytes) return;
      const note = ctx.notes.find((n) => n.includes(` ${e.path} `)) ?? `${ctx.harness} would load only part of ${e.path}`;
      const target = targetOf.get(e.path);
      if (target) {
        if (!cut.has(target)) cut.set(target, `would be cut: ${note}`);
      } else if (!cutBefore.has(`${ctx.harness} ${ctx.site} ${e.path}`)) {
        // The planned files loaded ahead of it took its room.
        for (const ahead of ctx.entries.slice(0, i)) {
          const t = targetOf.get(ahead.path);
          if (t && !cut.has(t)) cut.set(t, `would cut ${e.path}: ${note}`);
        }
      }
    });
  }
  if (cut.size === 0) return { plan, after };

  const actions = plan.actions.filter((a) => !cut.has(a.target));
  const gaps = plan.gaps.map((g) => (g.fill !== null && cut.has(g.fill) ? { ...g, fill: null, reason: cut.get(g.fill)! } : g));
  return { plan: { actions, gaps }, after: await scanWith(reader, actions, before.registry) };
}
