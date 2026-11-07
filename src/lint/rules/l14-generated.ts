import { GENERATED_FILE, generatedStatus } from '../../build/generated.js';
import type { Finding } from '../../model.js';
import type { Rule } from '../types.js';

const MESSAGES = {
  missing: (path: string) => `${path} is listed in ${GENERATED_FILE} but missing; run ctxlock build --fill-missing, or remove the entry`,
  edited: (path: string) => `${path} was edited after ctxlock generated it; edit its source instead, or remove the entry to keep the edit`,
  'source-missing': (path: string, source: string) => `${path} was generated from ${source}, which no longer exists`,
  stale: (path: string, source: string) => `${path} is out of date: ${source} changed since it was generated; run ctxlock build --fill-missing`,
};

export const generatedDrift: Rule = {
  id: 'L14-generated',
  async check({ reader, generated, generatedError }) {
    if (generatedError !== null) {
      return [{ rule: 'L14-generated', severity: 'should', message: `${GENERATED_FILE} is not valid: ${generatedError}`, path: GENERATED_FILE }];
    }
    const findings: Finding[] = [];
    for (const { path, state, source } of await generatedStatus(reader, generated)) {
      if (state === 'ok') continue;
      findings.push({ rule: 'L14-generated', severity: 'should', message: MESSAGES[state](path, source!), path });
    }
    return findings;
  },
};
