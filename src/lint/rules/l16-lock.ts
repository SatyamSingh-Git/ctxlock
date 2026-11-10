import type { Finding } from '../../model.js';
import { LOCK_FILE } from '../../sync/lock.js';
import { lfDigest } from '../../units/digest.js';
import type { Rule } from '../types.js';

// What ctxlock sync wrote is the upstream's: an edit here is lost at the next sync, and a pull request
// should not carry one. The digest is of the file read as LF, so a CRLF checkout is no edit.
export const lockDrift: Rule = {
  id: 'L16-lock',
  async check({ reader, registry, lock, lockError }) {
    if (lockError !== null) return [{ rule: 'L16-lock', severity: 'must', message: lockError, path: LOCK_FILE }];
    const findings: Finding[] = [];
    const stale = (message: string) => findings.push({ rule: 'L16-lock', severity: 'should', message: `${message}; run ctxlock sync`, path: LOCK_FILE });

    for (const u of lock.upstreams) {
      const declared = registry.upstreams.find((d) => d.name === u.name);
      if (!declared) stale(`${LOCK_FILE} pins upstream ${u.name}, which ctxlock.yaml no longer declares`);
      const at = `${u.name} at ${u.commit.slice(0, 7)}`;
      for (const unit of u.units) {
        if (declared && !declared.units.includes(unit.path)) stale(`${LOCK_FILE} pins ${unit.path} from ${u.name}, which ctxlock.yaml no longer lists`);
        for (const [path, digest] of Object.entries(unit.files)) {
          if (!(await reader.exists(path))) {
            findings.push({ rule: 'L16-lock', severity: 'must', path, message: `${path} is missing; ${LOCK_FILE} has it synced from ${at}; run ctxlock sync, or remove it from upstream units` });
          } else if (lfDigest(await reader.readFile(path)) !== digest) {
            findings.push({ rule: 'L16-lock', severity: 'must', path, message: `${path} differs from ${LOCK_FILE} (synced from ${at}); change it upstream, or remove it from upstream units` });
          }
        }
      }
    }
    return findings;
  },
};
