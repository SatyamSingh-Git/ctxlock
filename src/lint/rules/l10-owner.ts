import type { Finding } from '../../model.js';
import { unitOwners } from '../../registry/codeowners.js';
import type { Rule } from '../types.js';

export const owners: Rule = {
  id: 'L10-owner',
  check({ units, registry, codeowners }) {
    if (units.length === 0) return [];
    // With no ownership set up at all, one finding says so instead of one per unit.
    if (!registry.present && !codeowners.present) {
      const n = units.length;
      return [{ rule: 'L10-owner', severity: 'info', message: `No owners: add CODEOWNERS or owners in ctxlock.yaml (${n} unit${n === 1 ? '' : 's'})` }];
    }
    return units
      .filter((unit) => unitOwners(unit, registry, codeowners).length === 0)
      .map((unit): Finding => {
        const path = unit.kind === 'skill' ? `${unit.path}/SKILL.md` : unit.path;
        return { rule: 'L10-owner', severity: 'should', message: `${path} has no owner in CODEOWNERS or ctxlock.yaml`, path, unitId: unit.id };
      });
  },
};
