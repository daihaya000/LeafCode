/**
 * Next.js server-side instrumentation: runs once when the server starts
 * (dev and production), before any route handler reads env vars.
 *
 * Copies legacy OPENCODE_WEBUI_* env vars onto the LEAFCODE_* names so
 * pre-rebrand user configuration keeps working (see scripts/lib/env-compat.mjs).
 * next.config.ts already runs the same shim at build time; this covers the
 * runtime process spawned by `next start` / `next dev`.
 */
import { normalizeWebuiEnv } from "../../scripts/lib/env-compat.mjs";

export async function register() {
  normalizeWebuiEnv();
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Server-side OpenCode API generation follows the durable settings table
  // (written by the Settings → Engine tab), so goal-loop / hang-watchdog and
  // other server code use the same generation as the browser that configured
  // it — v1/v2 never mix for one session.
  const [{ registerServerOpenCodeApiGenerationResolver }, { readServerOpenCodeApiGeneration }] =
    await Promise.all([
      import("./lib/opencode-generation"),
      import("./lib/opencode-generation-server"),
    ]);
  registerServerOpenCodeApiGenerationResolver(readServerOpenCodeApiGeneration);

  const [{ startGoalLoopScheduler }, { startWorkflowScheduler }, { startHangWatchdog }, { startMemoryAutoExtractionMonitor }, { runStartupGitRestore }] =
    await Promise.all([
      import("./lib/goal-loop"),
      import("./lib/workflow-scheduler"),
      import("./lib/hang-watchdog"),
      import("./lib/memory-auto-extract"),
      import("./lib/git-restore"),
    ]);
  startGoalLoopScheduler();
  startWorkflowScheduler();
  startHangWatchdog();
  startMemoryAutoExtractionMonitor();
  // Fire-and-forget: restoring a zip install to git can take a while
  // (network clone) and must never block server startup.
  void runStartupGitRestore();

  const [{ installDependenciesOnStartup }] = await Promise.all([
    import("./lib/profiles/service"),
  ]);
  // Fire-and-forget: auto-distributing WebUI deps on boot must never block
  // server startup or crash it when a profile is unavailable.
  void Promise.resolve().then(installDependenciesOnStartup).catch(() => {});
}
