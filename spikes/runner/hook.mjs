// Run-scoped hook: append the event to a JSONL log; for PreToolUse, deny the call so nothing executes.
// Usage (from a settings file): node hook.mjs <event> <log.jsonl>
import { appendFileSync, readFileSync } from 'node:fs';

const [event, log] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(0, 'utf8'));
appendFileSync(log, `${JSON.stringify({ event, at: new Date().toISOString(), payload })}\n`);

if (event === 'PreToolUse') {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'observe-and-deny: this run records the intended action and does not execute it',
      },
    }),
  );
}
