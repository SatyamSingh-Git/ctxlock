import type { GeneratedFile } from '../build/generated.js';
import type { EffectiveContext } from '../harness/types.js';
import type { Limits } from '../harness/limits.js';
import type { Finding, Unit } from '../model.js';
import type { Codeowners } from '../registry/codeowners.js';
import type { Registry } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';
import type { Lock } from '../sync/lock.js';

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
  // From ctxlock.lock; an unreadable lock gives no upstreams and its error.
  lock: Lock;
  lockError: string | null;
  // false where the repository is someone else's (check): no directive or exception applies, and a
  // directive is hidden text like any other comment.
  suppressions?: boolean;
  // Whether agnix ran in this scan; without it, a suppression of an agnix rule cannot be told stale.
  agnixRan?: boolean;
}

export interface Rule {
  id: string;
  check(ctx: LintContext): Finding[] | Promise<Finding[]>;
}
