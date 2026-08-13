#!/usr/bin/env node
/**
 * agents-sync.mjs (CLI entry point)
 *
 * Global AGENTS.md/skills -> claude/codex/cursor/agents mirrors + Hermes
 * external_dirs. All logic is shared with the web UI via
 * `./lib/agents-sync-engine.mjs` (REFACTORING_PLAN P1-b / IMPROVEMENT 6-1).
 *
 * Usage: node scripts/agents-sync.mjs [--check]
 *   --check  dry-run; print status and exit non-zero if changes would be made
 */
import {
  applyAgentsSync,
  agentsSyncPaths,
  readAgentsSyncStatus,
} from "./lib/agents-sync-engine.mjs";

const dryRun = process.argv.includes("--check");

if (dryRun) {
  const status = readAgentsSyncStatus();
  const p = agentsSyncPaths();
  let wouldChange = 0;

  const masterMissing = !status.instructions.master.exists;
  console.log(
    masterMissing
      ? "[instructions:master] missing"
      : `[instructions:master] ${p.masterMd}`,
  );
  if (masterMissing) wouldChange++;

  for (const [side, item] of Object.entries({
    claude: status.instructions.claude,
    codex: status.instructions.codex,
    cursor: status.instructions.cursor,
  })) {
    console.log(`[instructions:${side}] ${item.status.message}`);
    if (item.status.kind === "wouldChange") wouldChange++;
  }

  for (const [key, item] of Object.entries(status.skills.mirrors)) {
    const [side, name] = key.split(":");
    console.log(`[skills:${side}:${name}] ${item.status.message}`);
    if (item.status.kind === "wouldChange") wouldChange++;
  }

  console.log(`[hermes] ${status.skills.hermes.status.message}`);
  if (status.skills.hermes.status.kind === "wouldChange") wouldChange++;

  console.log(`[agents-sync] plan: ${wouldChange} change(s) would be made`);
  process.exit(wouldChange > 0 ? 1 : 0);
}

const result = applyAgentsSync();
if (!result.ok && result.error) {
  console.error(`[agents-sync] ${result.error}`);
  process.exit(2);
}
console.log(
  `[agents-sync] done (instructions: ${result.instructions.copied} copied / ${result.instructions.skipped} skipped, skills: ${result.skills.created} created / ${result.skills.skipped} skipped, hermes: ${result.hermes.updated} updated / ${result.hermes.skipped} skipped)`,
);
for (const err of [...result.instructions.errors, ...result.skills.errors, ...result.hermes.errors]) {
  console.error(`[agents-sync] ${err}`);
}
const errors =
  result.instructions.errors.length +
  result.skills.errors.length +
  result.hermes.errors.length;
process.exit(errors > 0 ? 2 : 0);
