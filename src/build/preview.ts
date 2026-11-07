import type { Registry } from '../registry/registry.js';
import { overlayReader } from '../repo/overlay.js';
import type { RepoReader } from '../repo/reader.js';
import { type ScanResult, scanRepo } from '../scan.js';
import type { FillAction, FillPlan } from './plan.js';

const scanWith = (reader: RepoReader, actions: FillAction[], settings: Pick<Registry, 'harnesses' | 'limits' | 'lint'>) =>
  scanRepo(overlayReader(reader, new Map(actions.flatMap((a) => a.files.map((f) => [f.path, f.bytes] as const)))), { settings });

// Scans the repository as it would be after the fill, and drops each action whose file an agent
// would load only in part: a generated file that gets cut helps no one.
export async function previewFill(
  reader: RepoReader,
  plan: FillPlan,
  settings: Pick<Registry, 'harnesses' | 'limits' | 'lint'>,
): Promise<{ plan: FillPlan; after: ScanResult }> {
  const after = await scanWith(reader, plan.actions, settings);
  const targetOf = new Map(plan.actions.flatMap((a) => a.files.map((f) => [f.path, a.target] as const)));
  const cut = new Map<string, string>();
  for (const ctx of after.contexts) {
    for (const e of ctx.entries) {
      const target = targetOf.get(e.path);
      // A skill's entry names its folder, never a planned file, so a listed skill is never taken for a
      // cut file. A file Codex drops from its chain has loadedBytes 0.
      if (!target || cut.has(target) || e.loadedBytes >= e.bytes) continue;
      const note = ctx.notes.find((n) => n.includes(` ${e.path} `)) ?? `${ctx.harness} would load only part of ${e.path}`;
      cut.set(target, `would be cut: ${note}`);
    }
  }
  if (cut.size === 0) return { plan, after };

  const actions = plan.actions.filter((a) => !cut.has(a.target));
  const gaps = plan.gaps.map((g) => (g.fill !== null && cut.has(g.fill) ? { ...g, fill: null, reason: cut.get(g.fill)! } : g));
  return { plan: { actions, gaps }, after: await scanWith(reader, actions, settings) };
}
