/**
 * Format a child service status. A healthy service may be owned by an earlier
 * host process and intentionally reused, so HTTP health is authoritative even
 * when this process has no ChildProcess handle for it.
 */
export function formatServiceStatus(name, ownedProcessRunning, httpUp) {
  if (httpUp) return `${name}: running`;
  if (ownedProcessRunning) return `${name}: starting…`;
  return `${name}: stopped`;
}
