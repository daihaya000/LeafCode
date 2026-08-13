/** Module-scoped recently-replied request ids (survive TaskView remount). */

const STORE = new Map<string, number>();
const TTL_MS = 60_000;

const CHANNEL_NAME = "webui-sync";

function storeKey(requestId: string, sessionID?: string): string {
  return `${sessionID ?? ""}\u0000${requestId}`;
}

function prune(now: number) {
  for (const [id, at] of STORE) {
    if (now - at > TTL_MS) STORE.delete(id);
  }
}

const syncChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

syncChannel?.addEventListener("message", (event) => {
  const data = event.data as
    | { type?: string; key?: string; at?: number }
    | null;
  if (
    data?.type !== "recently-replied" ||
    typeof data.key !== "string" ||
    typeof data.at !== "number"
  ) {
    return;
  }
  STORE.set(data.key, data.at);
});

export function rememberReplied(requestId: string, sessionID?: string) {
  const now = Date.now();
  const key = storeKey(requestId, sessionID);
  STORE.set(key, now);
  prune(now);
  syncChannel?.postMessage({ type: "recently-replied", key, at: now });
}

export function wasRecentlyReplied(
  requestId: string,
  sessionID?: string,
): boolean {
  const now = Date.now();
  const key = storeKey(requestId, sessionID);
  const at = STORE.get(key);
  if (at === undefined) return false;
  if (now - at > TTL_MS) {
    STORE.delete(key);
    return false;
  }
  return true;
}

export function dropRecentlyReplied<
  T extends { id: string; sessionID?: string },
>(rows: T[]): T[] {
  const now = Date.now();
  return rows.filter((r) => {
    const key = storeKey(r.id, r.sessionID);
    const at = STORE.get(key);
    if (at === undefined) return true;
    if (now - at > TTL_MS) {
      STORE.delete(key);
      return true;
    }
    return false;
  });
}
