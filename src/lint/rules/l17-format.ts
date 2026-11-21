import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import type { Finding } from '../../model.js';
import { isInstant, okfTimes } from '../../units/okf.js';
import { OSSIE_SCHEMA } from '../../units/ossie-schema.js';
import type { Rule } from '../types.js';

const OSSIE_VERSION = '0.3.0.dev0';
const STATUSES = ['draft', 'stable', 'deprecated'];
const SHOWN = 5;

let validate: ReturnType<Ajv2020['compile']> | undefined;
const ossie = () => (validate ??= new Ajv2020({ allErrors: true, strict: false }).compile(OSSIE_SCHEMA));

const said = (e: ErrorObject) => `${e.instancePath || '(root)'}: ${e.message}${e.keyword === 'additionalProperties' ? ` (${String(e.params.additionalProperty)})` : ''}`;

export const format: Rule = {
  id: 'L17-format',
  check({ units }) {
    const findings: Finding[] = [];
    for (const unit of units) {
      const report = (severity: Finding['severity'], message: string) => findings.push({ rule: 'L17-format', severity, message, path: unit.path, unitId: unit.id });

      if (unit.kind === 'knowledge') {
        // Frontmatter that does not parse is already L0-frontmatter's.
        const fm = unit.frontmatter;
        if (!fm) continue;
        if (typeof fm.type !== 'string' || fm.type.trim() === '') report('must', `${unit.path} has no type: OKF needs a non-empty type string`);
        if ('status' in fm && !STATUSES.includes(fm.status as string)) report('should', `${unit.path} has status ${String(fm.status)}; OKF knows draft, stable and deprecated`);
        for (const [where, value] of okfTimes(fm)) {
          if (!isInstant(value)) report('should', `${unit.path}: ${where} is ${String(value)}, not an ISO 8601 time with an offset`);
        }
      }

      if (unit.kind === 'metric') {
        let model: unknown;
        try {
          // YAML 1.2 reads JSON too.
          model = parse(unit.text, { schema: 'core' });
        } catch (err) {
          report('must', `${unit.path} does not parse: ${(err as Error).message.split('\n')[0]}`);
          continue;
        }
        // Every other error follows from a version mismatch, so it is the only one said.
        const version = (model as { version?: unknown } | null)?.version;
        if (version !== OSSIE_VERSION) {
          report('must', `Ossie ${OSSIE_VERSION} is the version this checks; the file says ${version === undefined ? 'none' : String(version)}`);
          continue;
        }
        const check = ossie();
        if (check(model)) continue;
        const errors = check.errors ?? [];
        for (const e of errors.slice(0, SHOWN)) report('must', said(e));
        if (errors.length > SHOWN) report('must', `and ${errors.length - SHOWN} more`);
      }
    }
    return findings;
  },
};
