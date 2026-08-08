import { getJson, sendJson } from "./client";

export const HANG_TIMEOUT_SETTING_KEY = "hang-timeout";
export const HANG_TIMEOUT_EVENT = "webui:hang-timeout";
export const DEFAULT_HANG_TIMEOUT_MS = 5 * 60_000;
export const MIN_HANG_TIMEOUT_MS = 10_000;
export const MAX_HANG_TIMEOUT_MS = 30 * 60_000;
const STORAGE_KEY = "webui:hang-timeout";

export function clampHangTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HANG_TIMEOUT_MS;
  return Math.min(MAX_HANG_TIMEOUT_MS, Math.max(MIN_HANG_TIMEOUT_MS, Math.round(value)));
}

/** Human-readable threshold for notices, e.g. `5分` / `30秒`. */
export function formatHangTimeout(ms: number): string {
  const clamped = clampHangTimeoutMs(ms);
  if (clamped < 60_000) return `${Math.round(clamped / 1_000)}秒`;
  return `${Number((clamped / 60_000).toFixed(1))}分`;
}

export function readHangTimeoutMs(): number {
  if (typeof window === "undefined") return DEFAULT_HANG_TIMEOUT_MS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = Number(raw);
    return raw && Number.isFinite(value) ? clampHangTimeoutMs(value) : DEFAULT_HANG_TIMEOUT_MS;
  } catch {
    return DEFAULT_HANG_TIMEOUT_MS;
  }
}

export function writeHangTimeoutMs(value: number): void {
  const normalized = clampHangTimeoutMs(value);
  try {
    localStorage.setItem(STORAGE_KEY, String(normalized));
    window.dispatchEvent(new CustomEvent(HANG_TIMEOUT_EVENT));
  } catch {
    // Settings are best-effort when storage is unavailable.
  }
}

export function subscribeHangTimeout(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(HANG_TIMEOUT_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(HANG_TIMEOUT_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export async function syncHangTimeoutToServer(value: number): Promise<void> {
  try {
    await sendJson("PUT", `/api/settings/${HANG_TIMEOUT_SETTING_KEY}`, {
      value: String(clampHangTimeoutMs(value)),
    });
  } catch {
    // localStorage remains the synchronous source of truth.
  }
}

export async function readHangTimeoutFromServer(): Promise<number | null> {
  try {
    const data = await getJson<{ value: string | null }>(
      `/api/settings/${HANG_TIMEOUT_SETTING_KEY}`,
    );
    if (!data.value) return null;
    const value = Number(data.value);
    return Number.isFinite(value) ? clampHangTimeoutMs(value) : null;
  } catch {
    return null;
  }
}

/** Reconcile the client display with the server-side watchdog setting. */
export async function reconcileHangTimeout(): Promise<void> {
  const stored = await readHangTimeoutFromServer();
  if (stored !== null) {
    if (stored !== readHangTimeoutMs()) writeHangTimeoutMs(stored);
    return;
  }

  const local = readHangTimeoutMs();
  if (local !== DEFAULT_HANG_TIMEOUT_MS) await syncHangTimeoutToServer(local);
}
