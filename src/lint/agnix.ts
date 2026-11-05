import { execFile } from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';
import type { Finding, Severity } from '../model.js';

// Returns what `npx --yes agnix --format json <root>` prints.
export type AgnixRunner = (root: string) => Promise<string>;

const SEVERITY: Record<string, Severity> = { error: 'should', warning: 'info', info: 'info' };

const runNpx: AgnixRunner = (root) =>
  new Promise((resolve, reject) => {
    // npx is a .cmd file on Windows, and Node runs those only through a shell.
    const windows = process.platform === 'win32';
    const args = ['--yes', 'agnix', '--format', 'json', windows ? `"${root}"` : root];
    execFile(windows ? 'npx.cmd' : 'npx', args, { shell: windows, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // A linter's exit code reflects what it found, so its output is used whatever the exit code.
      if (stdout.trim()) resolve(stdout);
      else reject(err ?? new Error('agnix printed nothing'));
    });
  });

interface Diagnostic {
  level?: unknown;
  rule?: unknown;
  file?: unknown;
  line?: unknown;
  column?: unknown;
  message?: unknown;
}

export async function agnixFindings(root: string, run: AgnixRunner = runNpx): Promise<Finding[]> {
  const unavailable = (reason: string): Finding[] => [{ rule: 'agnix:unavailable', severity: 'info', message: `agnix could not run: ${reason}` }];
  let output: string;
  try {
    output = await run(root);
  } catch (err) {
    return unavailable((err as Error).message.split('\n')[0]!);
  }
  let parsed: { diagnostics?: unknown };
  try {
    parsed = JSON.parse(output) as { diagnostics?: unknown };
  } catch {
    return unavailable(`output is not JSON: ${output.trim().split('\n')[0]!.slice(0, 80)}`);
  }
  if (!Array.isArray(parsed?.diagnostics)) return unavailable('output has no diagnostics list');

  return (parsed.diagnostics as Diagnostic[]).map((d) => ({
    rule: `agnix:${String(d.rule)}`,
    severity: SEVERITY[String(d.level)] ?? 'info',
    message: String(d.message),
    ...(typeof d.file === 'string' ? { path: (isAbsolute(d.file) ? relative(root, d.file) : d.file).split(sep).join('/') } : {}),
    ...(typeof d.line === 'number' ? { line: d.line } : {}),
    ...(typeof d.column === 'number' ? { column: d.column } : {}),
  }));
}
