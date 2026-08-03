export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startGoalLoopScheduler }, { startWorkflowScheduler }, { startHangWatchdog }] =
    await Promise.all([
      import("./lib/goal-loop"),
      import("./lib/workflow-scheduler"),
      import("./lib/hang-watchdog"),
    ]);
  startGoalLoopScheduler();
  startWorkflowScheduler();
  startHangWatchdog();
}
