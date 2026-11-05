import type { EffectiveContext } from '../harness/types.js';
import type { Limits } from '../harness/limits.js';
import type { HarnessId } from '../model.js';

export interface BudgetRow {
  harness: HarnessId;
  site: string;
  alwaysBytes: number;
  limitBytes: number | null;
  catalogChars: number;
  catalogLimit: number | null;
  truncated: string[];
}

// Claude Code documents no total cap on always-on instructions or on its skill listing, so
// its limits are null rather than a guess.
export function budgetReport(contexts: EffectiveContext[], limits: Limits): BudgetRow[] {
  return contexts.map((ctx) => {
    const codex = ctx.harness === 'codex';
    return {
      harness: ctx.harness,
      site: ctx.site,
      alwaysBytes: ctx.alwaysBytes,
      limitBytes: codex ? limits.codexChainBytes : null,
      catalogChars: ctx.entries.reduce((sum, e) => sum + (e.mode === 'listed' ? (e.catalogChars ?? 0) : 0), 0),
      catalogLimit: codex ? limits.codexSkillCatalogChars : null,
      // A skill's body loads only when it is invoked, so loadedBytes 0 on a skill entry is not truncation.
      truncated: ctx.entries.filter((e) => e.catalogChars === undefined && e.loadedBytes < e.bytes).map((e) => e.path),
    };
  });
}
