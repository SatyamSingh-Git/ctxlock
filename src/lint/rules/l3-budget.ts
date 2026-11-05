import { posix } from 'node:path';
import { stringField } from '../../harness/claude-code.js';
import type { Finding } from '../../model.js';
import { budgetReport } from '../../report/budget.js';
import type { Rule } from '../types.js';

const where = (site: string) => (site === '' ? 'the repository root' : site);

export const harnessBudget: Rule = {
  id: 'L3-budget',
  check({ units, contexts, limits }) {
    const findings: Finding[] = [];
    const report = (severity: Finding['severity'], message: string, path?: string, unitId?: string) =>
      findings.push({ rule: 'L3-budget', severity, message, ...(path === undefined ? {} : { path }), ...(unitId === undefined ? {} : { unitId }) });
    const byId = new Map(units.map((u) => [u.id, u]));
    const reported = new Set<string>();

    budgetReport(contexts, limits).forEach((row, i) => {
      const { entries } = contexts[i]!;
      if (row.harness === 'codex') {
        const chain = entries.filter((e) => e.reason === 'chain' || e.reason === 'chain-dropped');
        const first = chain.find((e) => e.loadedBytes < e.bytes);
        if (first) {
          const total = chain.reduce((sum, e) => sum + e.bytes, 0);
          const lost = first.loadedBytes > 0 ? 'cut' : 'dropped';
          report('should', `AGENTS.md chain at ${where(row.site)} is ${total} bytes; Codex loads the first ${limits.codexChainBytes} (${first.path} ${lost})`, first.path, first.unitId);
        }
        if (row.catalogLimit !== null && row.catalogChars > row.catalogLimit) {
          report('should', `Codex skill catalog at ${where(row.site)} is ${row.catalogChars} characters, over the ${row.catalogLimit} Codex gives it`);
        }
        return;
      }

      // The same file shows up at every site that can load it, so each is reported once.
      for (const entry of entries) {
        const unit = byId.get(entry.unitId);
        if (!unit || reported.has(unit.id)) continue;
        if (entry.catalogChars === undefined && entry.loadedBytes < entry.bytes) {
          reported.add(unit.id);
          report('should', `${entry.path} is ${unit.text.length} characters; Claude Code reads only the first ${limits.claudeLazyFileChars} when it loads the file on demand`, entry.path, unit.id);
        }
        if (entry.catalogChars !== undefined) {
          const chars = stringField(unit.frontmatter, 'description').length + stringField(unit.frontmatter, 'when_to_use').length;
          if (chars <= limits.claudeSkillEntryChars) continue;
          reported.add(unit.id);
          report('should', `skill ${unit.name}: description and when_to_use are ${chars} characters; Claude Code cuts each skill listing entry at ${limits.claudeSkillEntryChars}`, `${unit.path}/SKILL.md`, unit.id);
        }
      }
    });

    for (const unit of units) {
      if (posix.basename(unit.path) === 'AGENTS.md' && unit.files[0]!.bytes > limits.devinCloudFileBytes) {
        report('info', `${unit.path} is ${unit.files[0]!.bytes} bytes; Devin's cloud agent reads only the first ${limits.devinCloudFileBytes}`, unit.path, unit.id);
      }
      const description = unit.kind === 'skill' ? unit.frontmatter?.description : undefined;
      if (typeof description !== 'string') continue;
      // Over skillDescriptionMax is already an L0-skill-spec error.
      const length = [...description].length;
      if (length > limits.skillDescriptionPortable && length <= limits.skillDescriptionMax) {
        report('info', `skill ${unit.name}: description is ${length} characters; some clients cut descriptions at ${limits.skillDescriptionPortable}`, `${unit.path}/SKILL.md`, unit.id);
      }
    }
    return findings;
  },
};
