import { getJson, sendJson } from "./client";

export const GENERATION_MODEL_SETTING_KEY = "generation-model";
const STORAGE_KEY = "webui:generation-model";
export const GENERATION_MODEL_EVENT = "webui:generation-model";
let writeQueue = Promise.resolve();

export function readGenerationModel(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeGenerationModel(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(GENERATION_MODEL_EVENT, { detail: value ?? "" }));
  } catch {
    /* ignore */
  }
}

export async function readGenerationModelFromServer(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  await writeQueue.catch(() => undefined);
  try {
    const data = await getJson<{ value: string | null }>(`/api/settings/${GENERATION_MODEL_SETTING_KEY}`);
    return data?.value && data.value.length > 0 ? data.value : null;
  } catch {
    return null;
  }
}

export async function writeGenerationModelToServer(value: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  const operation = writeQueue.then(async () => {
    try {
      await sendJson("PUT", `/api/settings/${GENERATION_MODEL_SETTING_KEY}`, { value });
    } catch (err) {
      console.warn("writeGenerationModelToServer failed", err);
    }
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  await operation;
}
