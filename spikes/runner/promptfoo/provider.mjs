// promptfoo custom provider that runs one S1 harness run per test case. The arm comes from the test's vars.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const runner = fileURLToPath(new URL('..', import.meta.url));

export default class ClaudeHarness {
  constructor(options = {}) {
    this.model = options.config?.model;
  }

  id() {
    return 'ctxlock-s1-harness';
  }

  async callApi(prompt, context) {
    const out = mkdtempSync(join(runner, '../../.superpowers/s1-runs/promptfoo-'));
    const model = this.model ? ['--model', this.model] : [];
    await run('node', [join(runner, 'run.mjs'), join(runner, 'fixture', context.vars.arm), prompt, out, ...model], { timeout: 300_000 });
    const s = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    return {
      output: s.denied.map((d) => d.input).join('\n'),
      cost: s.result?.total_cost_usd,
      tokenUsage: { prompt: s.result?.usage?.input_tokens, completion: s.result?.usage?.output_tokens },
      metadata: { loaded: s.loaded, unchanged: s.unchanged, turns: s.result?.num_turns },
      // A run that changed the fixture executed something, which observe-and-deny exists to prevent.
      ...(s.result?.is_error !== false ? { error: `run failed: ${s.result?.subtype ?? 'no result'}` } : s.unchanged ? {} : { error: 'the fixture changed' }),
    };
  }
}
