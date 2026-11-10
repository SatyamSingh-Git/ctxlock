import { posix } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { LIMITS, type Limits } from '../harness/limits.js';
import type { HarnessId, Severity } from '../model.js';
import type { RepoReader } from '../repo/reader.js';

// A repository path as people type it: from ./, with a closing slash, or with Windows separators.
export const repoPath = (path: string) => posix.normalize(path.replaceAll('\\', '/')).replace(/(.)\/+$/, '$1');

// Most trusted first.
export const TIERS = ['certified', 'reviewed', 'imported', 'proposal'] as const;
export type Tier = (typeof TIERS)[number];

// A unit's path or ID, and the tier it must have at least.
export interface Requirement {
  ref: string;
  tier?: Tier;
}

export interface UnitMeta {
  owner?: string;
  tier?: Tier;
  verifiedAt?: string;
  staleAfter?: string;
  sources?: string[];
  dependsOn?: Requirement[];
}

// An agent configuration that uses units (spec §4.2). Models and repos are recorded for the eval and
// sync plans; nothing reads them yet.
export interface Consumer {
  name: string;
  owner?: string;
  harnesses: HarnessId[];
  models: string[];
  repos: string[];
  dependsOn: Requirement[];
  evals: string[];
  maturity: 'experimental' | 'production' | 'deprecated';
}

// A repository this one takes units from (D69). Units are paths in it, and land at the same paths here.
export interface Upstream {
  name: string;
  repo: string;
  ref: string;
  units: string[];
  // Units this repository takes though their frontmatter runs hooks or grants tools (§7).
  allowExec: string[];
}

export interface Registry {
  present: boolean;
  harnesses: HarnessId[];
  units: Record<string, UnitMeta>;
  consumers: Consumer[];
  upstreams: Upstream[];
  limits: Partial<Limits>;
  lint: { severity: Record<string, Severity | 'off'>; ignore: string[] };
  eval: { model: string; runs: number; maxRuns: number; maxMinutes: number };
}

const EVAL_DEFAULTS = { model: 'sonnet', runs: 3, maxRuns: 24, maxMinutes: 20 };

export class RegistryError extends Error {}

const FILE = 'ctxlock.yaml';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');
const harness = z.enum(['claude-code', 'codex']);

// "path@tier". Only a bare word after the last @ is read as a tier, so an @ in a file or folder name,
// as in docs/@scope/a.md or notes@v2.md, stays part of the path.
const requirement = z
  .string()
  .min(1)
  .transform((text, ctx): Requirement => {
    const at = text.lastIndexOf('@');
    const suffix = text.slice(at + 1);
    if (at <= 0 || !/^[a-z]+$/i.test(suffix)) return { ref: text };
    if (!(TIERS as readonly string[]).includes(suffix)) {
      ctx.addIssue({ code: 'custom', message: `"${suffix}" is not a tier (${TIERS.join(', ')})` });
      return z.NEVER;
    }
    return { ref: text.slice(0, at), tier: suffix as Tier };
  });

const schema = z.strictObject({
  version: z.literal(1),
  harnesses: z.array(harness).default(['claude-code', 'codex']),
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
        tier: z.enum(TIERS).optional(),
        'verified-at': date.optional(),
        'stale-after': date.optional(),
        sources: z.array(z.string()).optional(),
        'depends-on': z.array(requirement).optional(),
      }),
    )
    .default({}),
  consumers: z
    .record(
      z.string(),
      z.strictObject({
        owner: z.string().optional(),
        harnesses: z.array(harness).optional(),
        models: z.array(z.string()).default([]),
        repos: z.array(z.string()).default([]),
        'depends-on': z.array(requirement).default([]),
        evals: z.array(z.string().transform(repoPath)).default([]),
        maturity: z.enum(['experimental', 'production', 'deprecated']).default('production'),
      }),
    )
    .default({}),
  upstream: z
    .record(
      z.string(),
      z.strictObject({
        repo: z.string().min(1),
        ref: z.string().min(1).default('main'),
        units: z.array(z.string().transform(repoPath)).default([]),
        'allow-exec': z.array(z.string().transform(repoPath)).default([]),
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
    return { present: false, harnesses: ['claude-code', 'codex'], units: {}, consumers: [], upstreams: [], limits: {}, lint: { severity: {}, ignore: [] }, eval: EVAL_DEFAULTS };
  }

  let raw: unknown;
  try {
    raw = parse((await reader.readFile(FILE)).toString('utf8'), { schema: 'core' });
  } catch (err) {
    throw new RegistryError(`${FILE}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(raw ?? {});
  if (!result.success) throw new RegistryError(`${FILE}: ${result.error.issues.map(describeIssue).join('; ')}`);

  const { harnesses, limits, units, consumers, upstream, lint, eval: settings } = result.data;
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
    consumers: Object.entries(consumers)
      .map(([name, c]): Consumer => ({
        name,
        ...(c.owner !== undefined && { owner: c.owner }),
        harnesses: c.harnesses ?? harnesses,
        models: c.models,
        repos: c.repos,
        dependsOn: c['depends-on'],
        evals: c.evals,
        maturity: c.maturity,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    upstreams: Object.entries(upstream)
      .map(([name, { 'allow-exec': allowExec, ...u }]): Upstream => ({ name, ...u, allowExec }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    lint,
    eval: {
      model: settings.model ?? EVAL_DEFAULTS.model,
      runs: settings.runs ?? EVAL_DEFAULTS.runs,
      maxRuns: settings['max-runs'] ?? EVAL_DEFAULTS.maxRuns,
      maxMinutes: settings['max-minutes'] ?? EVAL_DEFAULTS.maxMinutes,
    },
  };
}
