/**
 * agents-sync engine — global AGENTS.md/skills -> claude/codex/cursor/opencode.
 *
 * Delegated to the shared `scripts/lib/agents-sync-engine.mjs` implementation
 * so the web UI and CLI cannot drift (6-1 / REFACTORING_PLAN P1-b).
 * Types are re-exported for the API routes' imports.
 */
export {
  agentsSyncPaths,
  applyAgentsSync,
  readAgentsSyncStatus,
  readMasterAgents,
  writeMasterAgents,
  type AgentsSyncItemStatus,
  type AgentsSyncResult,
  type AgentsSyncStatus,
} from "../../../../scripts/lib/agents-sync-engine.mjs";
