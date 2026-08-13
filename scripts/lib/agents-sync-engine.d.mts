export type AgentsSyncItemStatus =
  | { kind: "ok"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "wouldChange"; message: string }
  | { kind: "blocked"; message: string };

export type AgentsSyncPaths = {
  masterMd: string;
  claudeMd: string;
  codexMd: string;
  cursorMd: string;
  opencodeSkills: string;
  claudeSkills: string;
  codexSkills: string;
  agentsSkills: string;
  cursorSkills: string;
  hermesConfig: string;
};

export type AgentsSyncStatus = {
  instructions: {
    master: { path: string; exists: boolean };
    claude: { path: string; status: AgentsSyncItemStatus };
    codex: { path: string; status: AgentsSyncItemStatus };
    cursor: { path: string; status: AgentsSyncItemStatus };
  };
  skills: {
    opencodeRoot: { path: string; exists: boolean; count: number };
    mirrors: Record<string, { path: string; status: AgentsSyncItemStatus }>;
    hermes: { path: string; status: AgentsSyncItemStatus };
  };
};

export type AgentsSyncResult = {
  ok: boolean;
  instructions: { copied: number; skipped: number; errors: string[] };
  skills: { created: number; skipped: number; errors: string[] };
  hermes: { updated: number; skipped: number; errors: string[] };
  error?: string;
};

export function agentsSyncPaths(): AgentsSyncPaths;

export function readAgentsSyncStatus(): AgentsSyncStatus;

export function readMasterAgents(): {
  path: string;
  exists: boolean;
  content: string;
};

export function writeMasterAgents(content: string): { path: string };

export function applyAgentsSync(): AgentsSyncResult;
