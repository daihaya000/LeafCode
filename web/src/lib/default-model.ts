/**
 * Default model selection shared across Home (new task) and Task (follow-up)
 * composers. Persisted to localStorage so the user can set it once in Settings
 * and have it preselected on every new task/session.
 *
 * The value format matches the GhostSelect option value: `${providerID}::${modelID}`.
 * OpenCode config.model (provider/modelID) is still honored first when present
 * and the user has not explicitly chosen a default here.
 *
 * In addition to the localStorage fast path (used for instant UI hydration on
 * the same browser/origin), the value is mirrored to the server-side `settings`
 * table via `/api/settings/default-model` so it survives origin/session changes
 * and is shared across browsers. The localStorage copy remains the source of
 * truth for synchronous reads; the server copy is the durable backup.
 */

import { getJson, sendJson } from "./client";

const STORAGE_KEY = "webui:default-model";
export const DEFAULT_MODEL_EVENT = "webui:default-model";
let defaultModelWriteQueue = Promise.resolve();

/**
 * Last used model: the model actually applied to the most recent successful
 * submission in HomeView or TaskView. This takes priority over the user-
 * configured default model when resolving the initial model for a new
 * HomeView session, so the composer reuses whatever the user just sent
 * with instead of forcing them to re-pick it every time.
 */
const LAST_USED_STORAGE_KEY = "webui:last-used-model";
export const LAST_USED_MODEL_EVENT = "webui:last-used-model";

export function readDefaultModel(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeDefaultModel(value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(
      new CustomEvent(DEFAULT_MODEL_EVENT, { detail: value ?? "" }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Read the durable default-model from the server `settings` table. Returns
 * null when unset, when the request fails, or when running outside the
 * browser. Non-fatal: callers should fall back to `readDefaultModel()`.
 */
export async function readDefaultModelFromServer(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const data = await getJson<{ value: string | null }>(
      "/api/settings/default-model",
    );
    const value = data?.value;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the default-model to the server `settings` table. Non-fatal: the
 * localStorage copy has already been updated synchronously by the caller, so
 * a server write failure only means the value won't sync to other browsers.
 */
export async function writeDefaultModelToServer(
  value: string | null,
): Promise<void> {
  if (typeof window === "undefined") return;
  const operation = defaultModelWriteQueue.then(async () => {
    try {
      await sendJson("PUT", "/api/settings/default-model", { value });
    } catch (err) {
      console.warn("writeDefaultModelToServer failed", err);
    }
  });
  defaultModelWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
}

export function readLastUsedModel(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_USED_STORAGE_KEY);
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLastUsedModel(value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(LAST_USED_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(LAST_USED_STORAGE_KEY);
    }
    window.dispatchEvent(
      new CustomEvent(LAST_USED_MODEL_EVENT, { detail: value ?? "" }),
    );
  } catch {
    /* ignore */
  }
}
