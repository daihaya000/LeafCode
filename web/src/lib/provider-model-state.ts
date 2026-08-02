import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

type StateFile = {
  disabled: Record<string, true>;
  providerOrder: string[];
  modelOrder: Record<string, string[]>;
  providerIcons: Record<string, string>;
};

/**
 * Defaults used when a profile has no WebUI provider/model state yet.
 *
 * Keep the provider/model IDs here rather than in a profile config file: the
 * enabled state is intentionally WebUI-local and is not part of OpenCode's
 * configuration schema.  Unknown providers/models are appended naturally by
 * the provider list code.
 */
const DEFAULT_STATE: StateFile = {
  disabled: { "anthropic::claude-fable-5": true },
  providerOrder: ["openai", "anthropic"],
  modelOrder: {
    openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
    anthropic: [
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ],
  },
  providerIcons: {},
};

function emptyState(): StateFile {
  return {
    disabled: { ...DEFAULT_STATE.disabled },
    providerOrder: [...DEFAULT_STATE.providerOrder],
    modelOrder: Object.fromEntries(
      Object.entries(DEFAULT_STATE.modelOrder).map(([providerID, order]) => [
        providerID,
        [...order],
      ]),
    ),
    providerIcons: {},
  };
}

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
 * Returns an empty state when the file does not exist or is malformed JSON.
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
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Validate that all values are `true`.
      const disabled: Record<string, true> = {};
      if (
        parsed.disabled &&
        typeof parsed.disabled === "object" &&
        !Array.isArray(parsed.disabled)
      ) {
        for (const [key, value] of Object.entries(parsed.disabled)) {
          if (value === true) disabled[key] = true;
        }
      }
      const providerOrder = Array.isArray(parsed.providerOrder)
        ? (parsed.providerOrder as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [];
      const modelOrder: Record<string, string[]> = {};
      if (
        parsed.modelOrder &&
        typeof parsed.modelOrder === "object" &&
        !Array.isArray(parsed.modelOrder)
      ) {
        for (const [providerID, order] of Object.entries(parsed.modelOrder)) {
          if (Array.isArray(order)) {
            modelOrder[providerID] = order.filter(
              (id): id is string => typeof id === "string",
            );
          }
        }
      }
      const providerIcons: Record<string, string> = {};
      if (
        parsed.providerIcons &&
        typeof parsed.providerIcons === "object" &&
        !Array.isArray(parsed.providerIcons)
      ) {
        for (const [providerID, icon] of Object.entries(parsed.providerIcons)) {
          if (typeof icon === "string" && icon) providerIcons[providerID] = icon;
        }
      }
      return { disabled, providerOrder, modelOrder, providerIcons };
    }
    console.warn(
      "[provider-model] 状態ファイルの形式が不正なため無視します",
    );
    return emptyState();
  } catch (err) {
    console.warn(
      "[provider-model] 状態ファイルが壊れているため無視します",
      err,
    );
    return emptyState();
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

function mergeKnownOrder(next: string[], existing: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of next) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of existing) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

export async function setProviderModelOrder(input: {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
}): Promise<void> {
  const state = readProviderModelState();
  if (input.providerOrder) {
    state.providerOrder = mergeKnownOrder(input.providerOrder, state.providerOrder);
  }
  if (input.modelOrder) {
    for (const [providerID, order] of Object.entries(input.modelOrder)) {
      state.modelOrder[providerID] = mergeKnownOrder(
        order,
        state.modelOrder[providerID] ?? [],
      );
    }
  }
  await writeProviderModelState(state);
}

export async function setProviderIcon(
  providerID: string,
  icon: string | undefined,
): Promise<void> {
  const state = readProviderModelState();
  const trimmed = icon?.trim();
  if (trimmed) state.providerIcons[providerID] = trimmed;
  else delete state.providerIcons[providerID];
  await writeProviderModelState(state);
}

/**
 * Drop every WebUI-local trace of a provider that was removed from
 * `opencode.jsonc`: its own disabled flag, all `providerID::modelID`
 * disabled flags, its saved model order, its position in providerOrder,
 * and its icon override.
 */
export async function removeProviderState(providerID: string): Promise<void> {
  const state = readProviderModelState();
  delete state.disabled[providerID];
  const prefix = `${providerID}::`;
  for (const key of Object.keys(state.disabled)) {
    if (key.startsWith(prefix)) delete state.disabled[key];
  }
  state.providerOrder = state.providerOrder.filter((id) => id !== providerID);
  delete state.modelOrder[providerID];
  delete state.providerIcons[providerID];
  await writeProviderModelState(state);
}
