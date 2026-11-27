import { type Finding, modelled } from '../model.js';
import { skillSpec } from './rules/l0-skill-spec.js';
import { hiddenUnicode, htmlComment } from './rules/l1-hidden.js';
import { execConfig, riskyInstruction } from './rules/l2-exec.js';
import { harnessBudget } from './rules/l3-budget.js';
import { discoverable } from './rules/l4-discoverable.js';
import { instructionCount } from './rules/l5-instructions.js';
import { skillLength } from './rules/l6-skill-length.js';
import { duplicateSkills } from './rules/l7-duplicates.js';
import { procedure } from './rules/l8-procedure.js';
import { staleReferences } from './rules/l9-stale.js';
import { owners } from './rules/l10-owner.js';
import { coverage } from './rules/l11-coverage.js';
import { shadowedAgentsMd } from './rules/l13-shadowed.js';
import { generatedDrift } from './rules/l14-generated.js';
import { graphRefs } from './rules/l15-graph.js';
import { lockDrift } from './rules/l16-lock.js';
import { format } from './rules/l17-format.js';
import { findDirectives, quiet } from './suppress.js';
import type { LintContext, Rule } from './types.js';

export const RULES: Rule[] = [
  skillSpec,
  hiddenUnicode,
  htmlComment,
  riskyInstruction,
  execConfig,
  harnessBudget,
  discoverable,
  instructionCount,
  skillLength,
  duplicateSkills,
  procedure,
  staleReferences,
  owners,
  coverage,
  shadowedAgentsMd,
  generatedDrift,
  graphRefs,
  lockDrift,
  format,
];

const RANK = { must: 0, should: 1, info: 2 };
const byCodeUnit = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);

// Rules that hold for every agent's files: the safety checks, owners, and L15, which judges ctxlock.yaml
// itself. The rest are tuned to the agents ctxlock models and see only their units.
const ALL_UNITS: ReadonlySet<Rule> = new Set([hiddenUnicode, htmlComment, riskyInstruction, execConfig, owners, graphRefs]);

export async function runLint(ctx: LintContext, extra: Finding[] = []): Promise<Finding[]> {
  const found = [...extra];
  const known = { ...ctx, units: ctx.units.filter(modelled) };
  for (const rule of RULES) found.push(...(await rule.check(ALL_UNITS.has(rule) ? ctx : known)));

  const { severity } = ctx.registry.lint;
  const rated: Finding[] = [];
  for (const f of found) {
    const override = severity[f.rule];
    if (override !== 'off') rated.push(override ? { ...f, severity: override } : f);
  }
  const kept = new Map<string, Finding>();
  for (const finding of quiet(rated, ctx, ctx.suppressions === false ? [] : await findDirectives(ctx))) {
    const key = JSON.stringify([finding.rule, finding.severity, finding.path, finding.line, finding.column, finding.message]);
    if (!kept.has(key)) kept.set(key, finding);
  }

  return [...kept.values()].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      byCodeUnit(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
}
