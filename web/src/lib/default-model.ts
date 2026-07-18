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