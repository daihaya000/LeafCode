/** Fire when projects/tasks change so the sidebar can refresh. */
export function notifyTasksChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("webui:tasks-changed"));
  }
}

/** Fire when the global attention queue count changes so badges can refresh. */
export function notifyAttentionCountChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("webui:attention-count-changed"));
  }
}
