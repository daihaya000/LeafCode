export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startGoalLoopScheduler }, { startWorkflowScheduler }, { startHangWatchdog }, { runStartupGitRestore }] =
    await Promise.all([
      import("./lib/goal-loop"),
      import("./lib/workflow-scheduler"),
      import("./lib/hang-watchdog"),
      import("./lib/git-restore"),
    ]);
  startGoalLoopScheduler();
  startWorkflowScheduler();
  startHangWatchdog();
  // Fire-and-forget: restoring a zip install to git can take a while
  // (network clone) and must never block server startup.
  void runStartupGitRestore();
}
