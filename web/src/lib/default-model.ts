/**
 * Default model selection shared across Home (new task) and Task (follow-up)
 * composers. Persisted to localStorage so the user can set it once in Settings
 * and have it preselected on every new task/session.
 *
 * The value format matches the GhostSelect option value: `${providerID}::${modelID}`.
 * OpenCode config.model (provider/modelID) is still honored first when present
 * and the user has not explicitly chosen a default here.
 */

const STORAGE_KEY = "webui:default-model";
export const DEFAULT_MODEL_EVENT = "webui:default-model";

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