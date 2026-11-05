export type Severity = 'must' | 'should' | 'info';

export type HarnessId = 'claude-code' | 'codex';

export type UnitKind = 'instructions' | 'rule' | 'skill' | 'config';

export interface UnitFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface Unit {
  id: string;
  kind: UnitKind;
  family: 'agents-md' | 'claude' | 'agents' | 'codex' | 'vscode';
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
