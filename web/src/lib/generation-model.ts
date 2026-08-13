import { createSettingSync } from "./setting-sync";

export const GENERATION_MODEL_SETTING_KEY = "generation-model";
export const GENERATION_MODEL_EVENT = "webui:generation-model";

/**
 * Reasoning effort paired with the generation model (title / next-action /
 * commit message). The server-side generation routes forward it as the
 * prompt `variant`. Stored as a plain `IntelligenceVariant` string (e.g.
 * "low", "high") or "" when unset.
 */
export const GENERATION_MODEL_EFFORT_SETTING_KEY = "generation-model-effort";
export const GENERATION_MODEL_EFFORT_EVENT = "webui:generation-model-effort";

// localStorage + write-queue + server-mirror の同期パターンは
// createSettingSync に集約（REFACTORING_PLAN P4-d / IMPROVEMENT 2-2）。
const modelSync = createSettingSync({
  storageKey: "webui:generation-model",
  serverPath: `/api/settings/${GENERATION_MODEL_SETTING_KEY}`,
  eventName: GENERATION_MODEL_EVENT,
});

const effortSync = createSettingSync({
  storageKey: "webui:generation-model-effort",
  serverPath: `/api/settings/${GENERATION_MODEL_EFFORT_SETTING_KEY}`,
  eventName: GENERATION_MODEL_EFFORT_EVENT,
});

export function readGenerationModelEffort(): string | null {
  return effortSync.read();
}

export function writeGenerationModelEffort(value: string | null): void {
  effortSync.write(value);
}

export async function readGenerationModelEffortFromServer(): Promise<string | null> {
  return effortSync.readFromServer();
}

export async function writeGenerationModelEffortToServer(
  value: string | null,
): Promise<void> {
  await effortSync.writeToServer(value);
}

export function readGenerationModel(): string | null {
  return modelSync.read();
}

export function writeGenerationModel(value: string | null): void {
  modelSync.write(value);
}

export async function readGenerationModelFromServer(): Promise<string | null> {
  return modelSync.readFromServer();
}

export async function writeGenerationModelToServer(value: string | null): Promise<void> {
  await modelSync.writeToServer(value);
}
