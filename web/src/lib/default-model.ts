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
 *
 * The localStorage + write-queue + server-mirror pattern is shared via
 * `createSettingSync` (REFACTORING_PLAN P4-d / IMPROVEMENT 2-2).
 */

import { createSettingSync } from "./setting-sync";

export const DEFAULT_MODEL_EVENT = "webui:default-model";

/**
 * Reasoning effort paired with the default model. The Home/Task composers
 * preselect the stored effort when the initial model comes from the default
 * model, so the Settings screen can pin both at once. Stored as a plain
 * `IntelligenceVariant` string (e.g. "low", "high") or "" when unset.
 */
export const DEFAULT_MODEL_EFFORT_SETTING_KEY = "default-model-effort";
export const DEFAULT_MODEL_EFFORT_EVENT = "webui:default-model-effort";

const defaultModelSync = createSettingSync({
  storageKey: "webui:default-model",
  serverPath: "/api/settings/default-model",
  eventName: DEFAULT_MODEL_EVENT,
});

const effortSync = createSettingSync({
  storageKey: "webui:default-model-effort",
  serverPath: `/api/settings/${DEFAULT_MODEL_EFFORT_SETTING_KEY}`,
  eventName: DEFAULT_MODEL_EFFORT_EVENT,
});

export function readDefaultModelEffort(): string | null {
  return effortSync.read();
}

export function writeDefaultModelEffort(value: string | null): void {
  effortSync.write(value);
}

export async function readDefaultModelEffortFromServer(): Promise<string | null> {
  return effortSync.readFromServer();
}

export async function writeDefaultModelEffortToServer(
  value: string | null,
): Promise<void> {
  await effortSync.writeToServer(value);
}

/**
 * Last used model: the model actually applied to the most recent successful
 * submission in HomeView or TaskView. This takes priority over the user-
 * configured default model when resolving the initial model for a new
 * HomeView session, so the composer reuses whatever the user just sent
 * with instead of forcing them to re-pick it every time.
 */
export const LAST_USED_MODEL_EVENT = "webui:last-used-model";

const lastUsedSync = createSettingSync({
  storageKey: "webui:last-used-model",
  serverPath: "/api/settings/default-model",
  eventName: LAST_USED_MODEL_EVENT,
});

export function readDefaultModel(): string | null {
  return defaultModelSync.read();
}

export function writeDefaultModel(value: string | null): void {
  defaultModelSync.write(value);
}

/**
 * Read the durable default-model from the server `settings` table. Returns
 * null when unset, when the request fails, or when running outside the
 * browser. Non-fatal: callers should fall back to `readDefaultModel()`.
 *
 * Waits for any write already queued from this tab (e.g. a Clear click just
 * before a Settings tab remount re-triggers this fetch) so the GET can't
 * land ahead of an in-flight PUT and resurrect the value it just replaced.
 */
export async function readDefaultModelFromServer(): Promise<string | null> {
  return defaultModelSync.readFromServer();
}

/**
 * Persist the default-model to the server `settings` table. Non-fatal: the
 * localStorage copy has already been updated synchronously by the caller, so
 * a server write failure only means the value won't sync to other browsers.
 */
export async function writeDefaultModelToServer(
  value: string | null,
): Promise<void> {
  await defaultModelSync.writeToServer(value);
}

export function readLastUsedModel(): string | null {
  return lastUsedSync.read();
}

export function writeLastUsedModel(value: string | null): void {
  lastUsedSync.write(value);
}
