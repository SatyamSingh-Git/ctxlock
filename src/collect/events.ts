import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const session = { ts: z.string(), session: z.string(), cwd: z.string() };

// A line the collector (plugin/collect.mjs) writes, without its version and harness.
const recorded = z.discriminatedUnion('event', [
  z.object({ event: z.literal('session_start'), ...session, source: z.string().optional() }),
  z.object({
    event: z.literal('load'),
    ...session,
    file: z.string(),
    sha256: z.string().nullable(),
    reason: z.string(),
    trigger: z.string().optional(),
    parent: z.string().optional(),
  }),
  z.object({ event: z.literal('skill'), ...session, skill: z.string() }),
  z.object({ event: z.literal('error'), ts: z.string(), message: z.string() }),
]);

export type RecordedEvent = z.infer<typeof recorded>;

export const eventsHome = (env: NodeJS.ProcessEnv = process.env) => env.CTXLOCK_HOME || join(homedir(), '.ctxlock');

// Two sessions can append to a month's file at once, so a line can be cut short.
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readEvents(home: string): { events: RecordedEvent[]; skipped: number } {
  const folder = join(home, 'events');
  if (!existsSync(folder)) return { events: [], skipped: 0 };
  const events: RecordedEvent[] = [];
  let skipped = 0;
  for (const name of readdirSync(folder).filter((n) => n.endsWith('.jsonl')).sort()) {
    for (const text of readFileSync(join(folder, name), 'utf8').split('\n')) {
      if (!text.trim()) continue;
      const raw = parse(text) as { v?: unknown } | null;
      const result = raw?.v === 1 ? recorded.safeParse(raw) : null;
      if (result?.success) events.push(result.data);
      else skipped++;
    }
  }
  return { events, skipped };
}
