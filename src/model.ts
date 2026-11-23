export type Severity = 'must' | 'should' | 'info';

export type HarnessId = 'claude-code' | 'codex';

export type UnitKind = 'instructions' | 'rule' | 'skill' | 'config' | 'knowledge' | 'metric';

export interface UnitFile {
  path: string;
  bytes: number;
  sha256: string;
}

export type Family =
  | 'agents-md'
  | 'claude'
  | 'agents'
  | 'codex'
  | 'vscode'
  | 'okf'
  | 'ossie'
  | 'copilot'
  | 'cursor'
  | 'gemini'
  | 'antigravity'
  | 'devin'
  | 'kiro'
  | 'cline'
  | 'opencode'
  | 'junie'
  | 'other';

// Families whose loading ctxlock models. Units of the others get only the safety checks, and the
// agent models never see them.
export const MODELLED_FAMILIES: ReadonlySet<Family> = new Set(['agents-md', 'claude', 'agents', 'codex', 'vscode', 'okf', 'ossie']);
export const modelled = (unit: Unit) => MODELLED_FAMILIES.has(unit.family);

export const FAMILY_NAMES: Record<Family, string> = {
  'agents-md': 'agents that read AGENTS.md',
  claude: 'Claude Code',
  agents: 'agents that read .agents',
  codex: 'Codex',
  vscode: 'VS Code',
  okf: 'agents',
  ossie: 'agents',
  copilot: 'Copilot',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  antigravity: 'Antigravity',
  devin: 'Devin',
  kiro: 'Kiro',
  cline: 'Cline',
  opencode: 'OpenCode',
  junie: 'Junie',
  other: 'other agents',
};

export interface Unit {
  id: string;
  kind: UnitKind;
  family: Family;
  path: string;
  // In-repo symlinks that resolve to this unit, e.g. .claude/skills/x -> .agents/skills/x.
  aliases: string[];
  name: string;
  files: UnitFile[];
  digest: string;
  text: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  unitId?: string;
  data?: Record<string, string>;
}
