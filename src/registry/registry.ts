import { parse } from 'yaml';
import { z } from 'zod';
import { LIMITS, type Limits } from '../harness/limits.js';
import type { HarnessId, Severity } from '../model.js';
import type { RepoReader } from '../repo/reader.js';

export interface UnitMeta {
  owner?: string;
  tier?: 'certified' | 'reviewed' | 'imported' | 'proposal';
  verifiedAt?: string;
  staleAfter?: string;
  sources?: string[];
  dependsOn?: string[];
}

export interface Registry {
  present: boolean;
  harnesses: HarnessId[];
  units: Record<string, UnitMeta>;
  limits: Partial<Limits>;
  lint: { severity: Record<string, Severity | 'off'>; ignore: string[] };
  eval: { model: string; runs: number; maxRuns: number; maxMinutes: number };
}

const EVAL_DEFAULTS = { model: 'sonnet', runs: 3, maxRuns: 24, maxMinutes: 20 };

export class RegistryError extends Error {}

const FILE = 'ctxlock.yaml';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

const schema = z.strictObject({
  version: z.literal(1),
  harnesses: z.array(z.enum(['claude-code', 'codex'])).default(['claude-code', 'codex']),
  limits: z
    .strictObject(
      Object.fromEntries(Object.keys(LIMITS).map((key) => [key, z.number().int().nonnegative().optional()])),
    )
    .default({}),
  units: z
    .record(
      z.string(),
      z.strictObject({
        owner: z.string().optional(),
        tier: z.enum(['certified', 'reviewed', 'imported', 'proposal']).optional(),
        'verified-at': date.optional(),
        'stale-after': date.optional(),
        sources: z.array(z.string()).optional(),
        'depends-on': z.array(z.string()).optional(),
      }),
    )
    .default({}),
  lint: z
    .strictObject({
      severity: z.record(z.string(), z.enum(['must', 'should', 'info', 'off'])).default({}),
      ignore: z.array(z.string()).default([]),
    })
    .default({ severity: {}, ignore: [] }),
  eval: z
    .strictObject({
      model: z.string().min(1).optional(),
      runs: z.number().int().min(1).max(20).optional(),
      'max-runs': z.number().int().min(2).optional(),
      'max-minutes': z.number().int().min(1).optional(),
    })
    .default({}),
});

export function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String);
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => `${[...path, key].join('.')}: unknown key`).join('; ');
  }
  return `${path.join('.') || '(root)'}: ${issue.message}`;
}

export async function loadRegistry(reader: RepoReader): Promise<Registry> {
  if (!(await reader.exists(FILE))) {
    return { present: false, harnesses: ['claude-code', 'codex'], units: {}, limits: {}, lint: { severity: {}, ignore: [] }, eval: EVAL_DEFAULTS };
  }

  let raw: unknown;
  try {
    raw = parse((await reader.readFile(FILE)).toString('utf8'), { schema: 'core' });
  } catch (err) {
    throw new RegistryError(`${FILE}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(raw ?? {});
  if (!result.success) throw new RegistryError(`${FILE}: ${result.error.issues.map(describeIssue).join('; ')}`);

  const { harnesses, limits, units, lint, eval: settings } = result.data;
  return {
    present: true,
    harnesses,
    limits: Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as Partial<Limits>,
    units: Object.fromEntries(
      Object.entries(units).map(([path, u]) => [
        path,
        Object.fromEntries(
          Object.entries({
            owner: u.owner,
            tier: u.tier,
            verifiedAt: u['verified-at'],
            staleAfter: u['stale-after'],
            sources: u.sources,
            dependsOn: u['depends-on'],
          }).filter(([, v]) => v !== undefined),
        ) as UnitMeta,
      ]),
    ),
    lint,
    eval: {
      model: settings.model ?? EVAL_DEFAULTS.model,
      runs: settings.runs ?? EVAL_DEFAULTS.runs,
      maxRuns: settings['max-runs'] ?? EVAL_DEFAULTS.maxRuns,
      maxMinutes: settings['max-minutes'] ?? EVAL_DEFAULTS.maxMinutes,
    },
  };
}
