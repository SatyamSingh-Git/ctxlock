// S1 Step 2: each probe in each arm, `repeats` times, one run after another. Usage: node probes.mjs <out dir> [repeats] [--model <model>]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [out, repeats = '3', ...rest] = process.argv.slice(2);
const model = rest.includes('--model') ? ['--model', rest[rest.indexOf('--model') + 1]] : [];
const here = fileURLToPath(new URL('.', import.meta.url));
// What each probe should make the agent run in each arm: the head arm's AGENTS.md says to use pnpm.
const probes = [
  { id: 'add-dep', prompt: 'Add lodash as a dependency.', head: /\bpnpm\s+(add|install|i)\b[^\n]*lodash/, base: /\bnpm\s+(install|i|add)\b[^\n]*lodash/ },
  { id: 'run-tests', prompt: 'Run the tests.', head: /\bpnpm\s+(run\s+)?test\b/, base: /\bnpm\s+(run\s+)?test\b/ },
];

const rows = [];
for (const probe of probes) {
  for (const arm of ['base', 'head']) {
    for (let i = 1; i <= Number(repeats); i++) {
      const dir = join(out, `${probe.id}-${arm}-${i}`);
      mkdirSync(dir, { recursive: true });
      execFileSync('node', [join(here, 'run.mjs'), join(here, 'fixture', arm), probe.prompt, dir, ...model], { stdio: 'ignore' });
      const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
      const commands = s.denied.map((d) => d.input ?? '').join(' ; ');
      rows.push({
        probe: probe.id,
        arm,
        run: i,
        intended: probe[arm].test(commands),
        otherArm: probe[arm === 'head' ? 'base' : 'head'].test(commands),
        denied: s.denied,
        loaded: s.loaded.map((l) => `${l.file} (${l.reason})`),
        unchanged: s.unchanged,
        turns: s.result?.num_turns,
        durationMs: s.result?.duration_ms,
        costUsd: s.result?.total_cost_usd,
        inputTokens: (s.result?.usage?.input_tokens ?? 0) + (s.result?.usage?.cache_creation_input_tokens ?? 0) + (s.result?.usage?.cache_read_input_tokens ?? 0),
        outputTokens: s.result?.usage?.output_tokens,
        error: s.result?.is_error ?? true,
      });
      console.log(`${probe.id} ${arm} ${i}: intended=${rows.at(-1).intended} denied=${JSON.stringify(commands)} turns=${rows.at(-1).turns}`);
    }
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));
