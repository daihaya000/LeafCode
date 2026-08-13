export type SyncPaths = {
  opencode: string;
  codex: string;
  claude: string;
  cursor: string;
};

export type CodexTargetStatus = {
  exists: boolean;
  inSync: boolean;
  wouldChange: boolean;
  message: string;
};

export type CodexApplyResult = {
  exists: boolean;
  updated: boolean;
  message: string;
};

export type SyncPlan = {
  ok: boolean;
  masterServers: string[];
  targets: Record<string, CodexTargetStatus>;
  error?: string;
};

export type SyncApplyResult = {
  ok: boolean;
  masterServers: string[];
  changedFiles: number;
  targets: Record<string, CodexApplyResult>;
  error?: string;
};

export function planSync(options: {
  paths: SyncPaths;
  isDistributable?: (name: string) => boolean;
}): SyncPlan;

export function applySync(options: {
  paths: SyncPaths;
  isDistributable?: (name: string) => boolean;
}): SyncApplyResult;
