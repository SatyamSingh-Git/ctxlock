import type { HarnessId, Unit } from '../model.js';
import type { RepoReader } from '../repo/reader.js';
import type { Limits } from './limits.js';

// always: in context from session start. lazy: loaded when the agent touches a matching
// path. listed: only the name and description are in context until the skill is invoked.
export type LoadMode = 'always' | 'lazy' | 'listed';

export interface LoadEntry {
  unitId: string;
  path: string;
  mode: LoadMode;
  reason: string;
  bytes: number;
  loadedBytes: number;
  catalogChars?: number;
}

export interface EffectiveContext {
  harness: HarnessId;
  site: string;
  entries: LoadEntry[];
  alwaysBytes: number;
  notes: string[];
}

export interface ResolveInput {
  reader: RepoReader;
  units: Unit[];
  limits: Limits;
}
