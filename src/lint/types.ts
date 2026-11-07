import type { GeneratedFile } from '../build/generated.js';
import type { EffectiveContext } from '../harness/types.js';
import type { Limits } from '../harness/limits.js';
import type { Finding, Unit } from '../model.js';
import type { Codeowners } from '../registry/codeowners.js';
import type { Registry } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';

export interface LintContext {
  reader: RepoReader;
  units: Unit[];
  registry: Registry;
  codeowners: Codeowners;
  contexts: EffectiveContext[];
  limits: Limits;
  today: string; // YYYY-MM-DD
  // From .ctxlock/generated.json; an unreadable record gives no files and its error.
  generated: GeneratedFile[];
  generatedError: string | null;
}

export interface Rule {
  id: string;
  check(ctx: LintContext): Finding[] | Promise<Finding[]>;
}
