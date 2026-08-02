export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startGoalLoopScheduler }, { startWorkflowScheduler }] = await Promise.all([
    import("./lib/goal-loop"),
    import("./lib/workflow-scheduler"),
  ]);
  startGoalLoopScheduler();
  startWorkflowScheduler();
}
