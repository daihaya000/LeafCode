/** Module-scoped recently-replied request ids (survive TaskView remount). */

const STORE = new Map<string, number>();
const TTL_MS = 60_000;

function prune(now: number) {
  for (const [id, at] of STORE) {
    if (now - at > TTL_MS) STORE.delete(id);
  }
}

export function rememberReplied(requestId: string) {
  const now = Date.now();
  STORE.set(requestId, now);
  prune(now);
}

export function wasRecentlyReplied(requestId: string): boolean {
  const now = Date.now();
  const at = STORE.get(requestId);
  if (at === undefined) return false;
  if (now - at > TTL_MS) {
    STORE.delete(requestId);
    return false;
  }
  return true;
}

export function dropRecentlyReplied<T extends { id: string }>(rows: T[]): T[] {
  const now = Date.now();
  return rows.filter((r) => {
    const at = STORE.get(r.id);
    if (at === undefined) return true;
    if (now - at > TTL_MS) {
      STORE.delete(r.id);
      return true;
    }
    return false;
  });
}
