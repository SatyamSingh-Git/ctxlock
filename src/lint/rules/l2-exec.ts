import { type ParseError, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import type { Finding, Unit } from '../../model.js';
import { sha256Hex } from '../../units/digest.js';
import { lineAndColumn, quote, textFiles } from '../files.js';
import type { Rule } from '../types.js';

const SHELL = String.raw`(?:sudo\s+)?(?:ba|z)?sh\b`;

// One finding per kind per line, so a line that matches two download patterns is reported once.
const RISKY: Array<{ what: string; pattern: RegExp }> = [
  { what: 'pipes a download into a shell', pattern: new RegExp(String.raw`\b(?:curl|wget)\b[^\n]*\|\s*${SHELL}`) },
  { what: 'pipes a download into a shell', pattern: /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/ },
  { what: 'pipes a download into a shell', pattern: /\b(?:ba|z)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/ },
  { what: 'pipes a download into a shell', pattern: /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b/i },
  { what: 'pipes decoded base64 into a shell', pattern: new RegExp(String.raw`\bbase64\s+(?:-d|--decode)\b[^\n]*\|\s*${SHELL}`) },
  { what: 'runs an agent with its permission checks turned off', pattern: /--dangerously-skip-permissions\b|--yolo\b|--trust-all-tools\b/ },
  // Set, or followed by a URL: a list of variables an agent must not read names the variable but points nowhere.
  { what: 'points an agent at another API endpoint', pattern: /\b(?:ANTHROPIC|OPENAI)_BASE_URL\b(?:`?\s*=|[^\n]*https?:\/\/)/ },
  { what: 'turns on automatic approval of agent tools', pattern: /\bchat\.tools\.autoApprove\b|\benableAllProjectMcpServers\b/ },
];

export const riskyInstruction: Rule = {
  id: 'L2-risky-instruction',
  async check(ctx) {
    const findings: Finding[] = [];
    // Config files are inventoried item by item by L2-exec-config instead.
    for await (const { unit, path, text } of textFiles(ctx, (u) => u.kind !== 'config')) {
      text.split('\n').forEach((lineText, i) => {
        const reported = new Set<string>();
        for (const { what, pattern } of RISKY) {
          const match = pattern.exec(lineText);
          if (!match || reported.has(what)) continue;
          reported.add(what);
          const line = i + 1;
          const column = [...lineText.slice(0, match.index)].length + 1;
          findings.push({
            rule: 'L2-risky-instruction',
            severity: 'should',
            message: `${what} at ${line}:${column}: "${quote(lineText.trim())}"`,
            path,
            line,
            column,
            unitId: unit.id,
          });
        }
      });
    }
    return findings;
  },
};

const BOM = String.fromCodePoint(0xfeff);

function parseConfig(unit: Unit, raw: string): { value?: unknown; error?: string } {
  // Windows PowerShell 5.1 writes UTF-8 with a byte-order mark, which JSON.parse rejects.
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  // VS Code reads its settings as JSONC with trailing commas, and still applies whatever it could read
  // around a syntax error (ConfigurationModelParser in microsoft/vscode), so the partial value is kept.
  if (unit.family === 'vscode') {
    const errors: ParseError[] = [];
    const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length === 0) return { value };
    const { line, column } = lineAndColumn(text, errors[0]!.offset);
    return { value, error: `${printParseErrorCode(errors[0]!.error)} at ${line}:${column}` };
  }
  try {
    return { value: unit.path.endsWith('.toml') ? parseToml(text) : JSON.parse(text) };
  } catch (err) {
    return { error: (err as Error).message.split('\n')[0]! };
  }
}

type Kind = 'hook' | 'env' | 'mcp' | 'auto-approve' | 'command' | 'plugin';

interface Item {
  kind: Kind;
  key: string;
  message: string;
  // What the fingerprint covers: the item's identity and value, never its position in the file.
  value: unknown;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const entries = (v: unknown) => (isObject(v) ? Object.entries(v) : []);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const member = (parent: string, name: string) => (/^[A-Za-z_]\w*$/.test(name) ? `${parent}.${name}` : `${parent}[${JSON.stringify(name)}]`);

function hooks(value: unknown): Item[] {
  const items: Item[] = [];
  // Codex's [hooks] table also holds hooks.state, which is an object, not a list of matcher groups.
  for (const [event, groups] of entries(value)) {
    list(groups).forEach((group, g) => {
      if (!isObject(group)) return;
      const matcher = typeof group.matcher === 'string' && group.matcher !== '' && group.matcher !== '*' ? ` for ${group.matcher}` : '';
      list(group.hooks).forEach((handler, h) => {
        if (!isObject(handler)) return;
        items.push({
          kind: 'hook',
          key: `hooks.${event}[${g}].hooks[${h}]`,
          message: `${event} hook${matcher} ${does(handler)}`,
          value: { event, matcher: group.matcher, handler },
        });
      });
    });
  }
  return items;
}

function does(handler: Json): string {
  if (typeof handler.command === 'string') return `runs "${quote(handler.command)}"`;
  if (typeof handler.url === 'string') return `posts to ${handler.url}`;
  if (typeof handler.server === 'string') return `calls MCP tool ${handler.server}/${String(handler.tool)}`;
  return handler.type === 'agent' ? 'runs an agent' : `runs a ${String(handler.type)}`;
}

function mcpServers(parent: string, value: unknown): Item[] {
  return entries(value).flatMap(([name, server]): Item[] => {
    if (!isObject(server)) return [];
    const target =
      typeof server.command === 'string' ? `runs "${quote([server.command, ...list(server.args)].join(' '))}"` : `connects to ${String(server.url)}`;
    return [{ kind: 'mcp', key: member(parent, name), message: `MCP server ${name} ${target}`, value: { name, server } }];
  });
}

// Every variable, not a list of risky ones: NODE_OPTIONS, LD_PRELOAD, PATH and BASH_ENV all make the
// agent's processes run other code, and no list of such names is ever complete.
function env(parent: string, label: string, value: unknown): Item[] {
  return entries(value).map(([name, v]) => ({ kind: 'env', key: member(parent, name), message: `${label} sets ${name}`, value: { name, value: v } }));
}

const approval = (setting: string, key: string, name: string, value: unknown = name): Item => ({
  kind: 'auto-approve',
  key,
  message: `${setting} approves "${quote(name)}"`,
  value: { setting, name, value },
});

// Values that let an agent act without asking. A setting left at a value that still asks is not listed.
type Widening = Record<string, unknown[]>;
const CLAUDE_WIDENING: Widening = { enableAllProjectMcpServers: [true], 'permissions.defaultMode': ['acceptEdits', 'auto', 'bypassPermissions'] };
const CODEX_WIDENING: Widening = { approval_policy: ['never'], sandbox_mode: ['danger-full-access'] };
// enableAutoApprove and autoApproveWorkspaceNpmScripts already default to true, so setting them changes nothing.
const VSCODE_WIDENING: Widening = {
  'chat.tools.autoApprove': [true],
  'chat.tools.global.autoApprove': [true],
  'chat.tools.terminal.ignoreDefaultAutoApproveRules': [true],
  'chat.permissions.default': ['autoApprove', 'autopilot'],
};

const widened = (table: Widening, key: string, value: unknown): Item[] =>
  table[key]?.includes(value) ? [{ kind: 'auto-approve', key, message: `${key} = ${JSON.stringify(value)}`, value: { key, value } }] : [];

const CLAUDE_COMMANDS = new Set(['apiKeyHelper', 'otelHeadersHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'statusLine', 'fileSuggestion']);

function claudeSettings(config: Json): Item[] {
  return Object.entries(config).flatMap(([key, value]): Item[] => {
    if (key === 'hooks') return hooks(value);
    if (key === 'env') return env('env', 'env', value);
    if (CLAUDE_COMMANDS.has(key)) {
      const command = isObject(value) ? value.command : value;
      return typeof command === 'string' ? [{ kind: 'command', key, message: `${key} runs "${quote(command)}"`, value: { key, value } }] : [];
    }
    if (key === 'permissions' && isObject(value)) {
      return [
        ...list(value.allow).flatMap((rule, i) => (typeof rule === 'string' ? [approval('permissions.allow', `permissions.allow[${i}]`, rule)] : [])),
        ...widened(CLAUDE_WIDENING, 'permissions.defaultMode', value.defaultMode),
      ];
    }
    if (key === 'enabledMcpjsonServers') {
      return list(value).flatMap((name, i) => (typeof name === 'string' ? [approval(key, `${key}[${i}]`, name)] : []));
    }
    if (key === 'enabledPlugins') {
      return entries(value)
        .filter(([, on]) => on === true)
        .map(([name]) => ({ kind: 'plugin', key: member(key, name), message: `${key} turns on "${quote(name)}"`, value: { key, name } }));
    }
    if (key === 'extraKnownMarketplaces') {
      return entries(value).map(([name, source]) => ({ kind: 'plugin', key: member(key, name), message: `${key} adds "${quote(name)}"`, value: { key, name, source } }));
    }
    return widened(CLAUDE_WIDENING, key, value);
  });
}

function codexConfig(config: Json): Item[] {
  return Object.entries(config).flatMap(([key, value]): Item[] => {
    if (key === 'hooks') return hooks(value);
    if (key === 'mcp_servers') return mcpServers(key, value);
    if (key === 'shell_environment_policy' && isObject(value)) return env(`${key}.set`, key, value.set);
    return widened(CODEX_WIDENING, key, value);
  });
}

const VSCODE_RULES = new Set(['chat.tools.terminal.autoApprove', 'chat.agent.terminal.autoApprove', 'chat.tools.urls.autoApprove']);

// A rule approves when it is true, or an object with { approve } for commands or { approveRequest, approveResponse } for URLs.
const approves = (rule: unknown) => rule === true || (isObject(rule) && (rule.approve === true || rule.approveRequest === true || rule.approveResponse === true));

function vscodeSettings(config: Json): Item[] {
  return Object.entries(config).flatMap(([key, value]): Item[] => {
    if (VSCODE_RULES.has(key)) return entries(value).flatMap(([name, rule]) => (approves(rule) ? [approval(key, member(key, name), name, rule)] : []));
    return widened(VSCODE_WIDENING, key, value);
  });
}

function inventory(unit: Unit, config: unknown): Item[] {
  if (!isObject(config)) return [];
  if (unit.family === 'vscode') return vscodeSettings(config);
  if (unit.family === 'codex') return codexConfig(config);
  return unit.path.endsWith('.mcp.json') ? mcpServers('mcpServers', config.mcpServers) : claudeSettings(config);
}

// Sorted keys, so reformatting or reordering a file does not register as a change.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const execConfig: Rule = {
  id: 'L2-exec-config',
  async check(ctx) {
    const findings: Finding[] = [];
    for await (const { unit, path, text } of textFiles(ctx, (u) => u.kind === 'config')) {
      const parsed = parseConfig(unit, text);
      if (parsed.error !== undefined) {
        findings.push({ rule: 'L2-parse', severity: 'should', message: `could not parse ${path}: ${parsed.error}`, path, unitId: unit.id });
      }
      for (const { kind, key, message, value } of inventory(unit, parsed.value)) {
        // A hash rather than the canonical JSON itself: env values can be tokens, and findings reach PR comments.
        const fingerprint = `sha256:${sha256Hex(canonical({ file: path, kind, value }))}`;
        findings.push({ rule: 'L2-exec-config', severity: 'info', message, path, unitId: unit.id, data: { file: path, kind, key, fingerprint } });
      }
    }
    return findings;
  },
};
