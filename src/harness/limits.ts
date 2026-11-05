// Harness limits, each checked against the vendor's docs on 2026-11-05. These change often:
// re-check them before a release. Any of them can be overridden in ctxlock.yaml under `limits`.
export const LIMITS = {
  // learn.chatgpt.com/docs/agent-configuration/agents-md (project_doc_max_bytes)
  codexChainBytes: 32768,
  // learn.chatgpt.com/docs/build-skills (the fallback used when the context window is unknown)
  codexSkillCatalogChars: 8000,
  // code.claude.com/docs/en/skills (description + when_to_use per listing entry)
  claudeSkillEntryChars: 1536,
  // code.claude.com/docs/en/memory (lazily loaded files, 200K-token window)
  claudeLazyFileChars: 40000,
  // code.claude.com/docs/en/memory (files loaded at launch over 4 MiB are skipped)
  claudeLaunchFileBytes: 4194304,
  // code.claude.com/docs/en/memory
  claudeImportHops: 4,
  // docs.devin.ai/onboard-devin/agents-md.md
  devinCloudFileBytes: 16384,
  // agentskills.io/specification
  skillNameMax: 64,
  skillDescriptionMax: 1024,
  skillCompatibilityMax: 500,
  // developers.glean.com/guides/agents/specification.md, the lowest limit among common clients
  skillDescriptionPortable: 1000,
  // agentskills.io recommends under 500 lines and about 5k tokens (~4 characters per token)
  skillBodyLines: 500,
  skillBodyChars: 20000,
  // IFScale (research/03 §6): frontier models start dropping instructions past ~150 at once
  alwaysOnInstructionItems: 150,
} as const;

export type Limits = { -readonly [K in keyof typeof LIMITS]: number };
