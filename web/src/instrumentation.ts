export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startGoalLoopScheduler } = await import("./lib/goal-loop");
  startGoalLoopScheduler();
}
