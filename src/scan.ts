import { LIMITS } from './harness/limits.js';
import { resolveAll } from './harness/resolve.js';
import type { EffectiveContext } from './harness/types.js';
import { type AgnixRunner, agnixFindings } from './lint/agnix.js';
import { runLint } from './lint/run.js';
import type { Finding, Unit } from './model.js';
import { loadCodeowners } from './registry/codeowners.js';
import { loadRegistry, type Registry } from './registry/registry.js';
import type { RepoReader } from './repo/reader.js';
import { type BudgetRow, budgetReport } from './report/budget.js';
import { discoverUnits } from './units/discover.js';

export interface ScanResult {
  root: string;
  ref: string | null;
  units: Unit[];
  registry: Registry;
  contexts: EffectiveContext[];
  budget: BudgetRow[];
  findings: Finding[];
}

const localDate = (d = new Date()) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');

export interface ScanOptions {
  agnix?: boolean;
  runAgnix?: AgnixRunner;
  today?: string;
  // Settings that decide what is checked, taken from elsewhere: diff scans a pull request with the
  // base branch's, so the pull request cannot switch off the checks that judge it.
  settings?: Pick<Registry, 'harnesses' | 'limits' | 'lint'>;
}

export async function scanRepo(reader: RepoReader, opts: ScanOptions = {}): Promise<ScanResult> {
  const { units, problems } = await discoverUnits(reader);
  const loaded = await loadRegistry(reader);
  const registry = opts.settings ? { ...loaded, harnesses: opts.settings.harnesses, limits: opts.settings.limits, lint: opts.settings.lint } : loaded;
  const codeowners = await loadCodeowners(reader);
  const limits = { ...LIMITS, ...registry.limits };
  const contexts = await resolveAll({ reader, units, limits }, registry.harnesses);
  const extra = opts.agnix ? await agnixFindings(reader.root, opts.runAgnix) : [];
  const findings = await runLint({ reader, units, registry, codeowners, contexts, limits, today: opts.today ?? localDate() }, [...problems, ...extra]);
  return { root: reader.root, ref: reader.ref, units, registry, contexts, budget: budgetReport(contexts, limits), findings };
}
