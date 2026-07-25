import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

type StateFile = { disabled: Record<string, true> };

function statePath(): string {
  return path.join(dataDir(), "provider-model-state.json");
}

/**
 * Atomic write: temp file in the same directory + rename.
 * Same pattern as `atomicWriteFile` in `jsonc-edit.ts`.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.promises.writeFile(tmp, content, "utf8");
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Read the provider-model state file.
 * Returns `{ disabled: {} }` when the file does not exist or is malformed JSON.
 */
export function readProviderModelState(): StateFile {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        "[provider-model] 状態ファイルを読み込めません",
        err,
      );
    }
    return { disabled: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.disabled &&
      typeof parsed.disabled === "object" &&
      !Array.isArray(parsed.disabled)
    ) {
      // Validate that all values are `true`.
      const disabled: Record<string, true> = {};
      for (const [key, value] of Object.entries(parsed.disabled)) {
        if (value === true) {
          disabled[key] = true;
        }
      }
      return { disabled };
    }
    console.warn(
      "[provider-model] 状態ファイルの形式が不正なため無視します",
    );
    return { disabled: {} };
  } catch (err) {
    console.warn(
      "[provider-model] 状態ファイルが壊れているため無視します",
      err,
    );
    return { disabled: {} };
  }
}

/**
 * Persist the full state atomically.
 */
export async function writeProviderModelState(
  state: StateFile,
): Promise<void> {
  await atomicWrite(
    statePath(),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

/**
 * Check whether a provider is disabled.
 */
export function isProviderDisabled(providerID: string): boolean {
  const state = readProviderModelState();
  return state.disabled[providerID] === true;
}

/**
 * Check whether a model is disabled.
 * The key is `providerID::modelID`.
 */
export function isModelDisabled(
  providerID: string,
  modelID: string,
): boolean {
  const state = readProviderModelState();
  return state.disabled[`${providerID}::${modelID}`] === true;
}

/**
 * Set or clear a disabled entry for a provider or model key.
 * `key` is `providerID` or `providerID::modelID`.
 * When `disabled` is true, the key is set to `true`.
 * When `disabled` is false, the key is removed.
 */
export async function setProviderModelDisabled(
  key: string,
  disabled: boolean,
): Promise<void> {
  const state = readProviderModelState();
  if (disabled) {
    state.disabled[key] = true;
  } else {
    delete state.disabled[key];
  }
  await writeProviderModelState(state);
}
