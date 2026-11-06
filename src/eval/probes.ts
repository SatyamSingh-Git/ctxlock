import { parse } from 'yaml';
import { z } from 'zod';
import { describeIssue } from '../registry/registry.js';
import type { RepoReader } from '../repo/reader.js';
import { sha256Hex } from '../units/digest.js';
import type { Transcript } from './claude.js';

export type Expectation = { command: string } | { edit: string } | { skill: string };

export interface Probe {
  id: string;
  file: string;
  unit: string;
  prompt: string;
  expect: Expectation;
  // Passes when the expectation is not met: a should-not-trigger probe.
  not: boolean;
  kind: 'adherence' | 'trigger';
  hash: string;
}

export class ProbeError extends Error {}

const schema = z.strictObject({
  version: z.literal(1),
  probes: z.array(
    z.strictObject({
      id: z.string().min(1),
      unit: z.string().min(1),
      prompt: z.string().min(1),
      expect: z.strictObject({
        command: z.string().optional(),
        edit: z.string().optional(),
        skill: z.string().optional(),
        not: z.boolean().default(false),
      }),
    }),
  ),
});

export function parseProbeFile(text: string, file: string): Probe[] {
  let raw: unknown;
  try {
    raw = parse(text, { schema: 'core' });
  } catch (err) {
    throw new ProbeError(`${file}: ${(err as Error).message}`);
  }
  const result = schema.safeParse(raw ?? {});
  if (!result.success) throw new ProbeError(`${file}: ${result.error.issues.map(describeIssue).join('; ')}`);

  return result.data.probes.map(({ id, unit, prompt, expect: { not, ...given } }) => {
    const keys = Object.keys(given) as Array<'command' | 'edit' | 'skill'>;
    if (keys.length !== 1) throw new ProbeError(`${file}: probe ${id}: expect needs exactly one of command, edit, skill`);
    const key = keys[0]!;
    const value = given[key]!;
    if (key !== 'skill') {
      try {
        new RegExp(value);
      } catch (err) {
        throw new ProbeError(`${file}: probe ${id}: invalid regular expression: ${(err as Error).message}`);
      }
    }
    const expect = { [key]: value } as Expectation;
    return { id, file, unit, prompt, expect, not, kind: key === 'skill' ? 'trigger' : 'adherence', hash: sha256Hex(JSON.stringify([id, unit, prompt, expect, not])) };
  });
}

export async function loadProbes(reader: RepoReader): Promise<Probe[]> {
  const files = (await reader.listFiles()).filter((p) => p.startsWith('evals/probes/') && /\.ya?ml$/.test(p));
  const probes: Probe[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    for (const probe of parseProbeFile((await reader.readFile(file)).toString('utf8'), file)) {
      const first = seen.get(probe.id);
      if (first) throw new ProbeError(`${file}: duplicate probe id ${probe.id} (${first}, ${file})`);
      seen.set(probe.id, file);
      probes.push(probe);
    }
  }
  return probes;
}

export function grade(probe: Probe, t: Transcript): boolean {
  const e = probe.expect;
  const met =
    'command' in e ? t.commands.some((c) => new RegExp(e.command).test(c))
    : 'edit' in e ? t.edits.some((p) => new RegExp(e.edit).test(p))
    : t.skills.includes(e.skill);
  return met !== probe.not;
}
