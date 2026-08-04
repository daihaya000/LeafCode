import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

type StateFile = {
  disabled: Record<string, true>;
  providerOrder: string[];
  modelOrder: Record<string, string[]>;
  providerIcons: Record<string, string>;
  /**
   * `providerID::modelID` keys whose default enabled/disabled state has
   * already been decided (either by an explicit user toggle, or by the
   * automatic "fast/old generation" default rule the first time the model
   * was seen). `undefined` only happens for state files written before this
   * field existed; callers must treat that as "grandfather every
   * currently-listed model" so upgrading never flips an existing profile's
   * models that were implicitly enabled.
   */
  knownModelKeys: string[] | undefined;
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
  knownModelKeys: [],
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
    // Brand-new profiles have nothing to grandfather, so the auto
    // fast/old-generation default rule applies from the very first list.
    knownModelKeys: [],
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
      // Missing/non-array `knownModelKeys` means this file predates the
      // field (a used profile from an older build): treat as "legacy" so
      // listProviderModels grandfathers in every model it currently sees
      // instead of retroactively applying the fast/old-generation default.
      const knownModelKeys = Array.isArray(parsed.knownModelKeys)
        ? (parsed.knownModelKeys as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : undefined;
      return { disabled, providerOrder, modelOrder, providerIcons, knownModelKeys };
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
 * Serializes every read-modify-write against the state file within this
 * process. `atomicWrite` only makes a single write atomic at the filesystem
 * level — it does nothing to stop two concurrent callers from both reading
 * the pre-update state and one overwriting the other's change (a lost
 * update). Every mutator below must go through this queue instead of calling
 * `readProviderModelState`/`writeProviderModelState` directly.
 */
let stateWriteQueue: Promise<unknown> = Promise.resolve();

function withStateLock<T>(mutate: (state: StateFile) => T | StateFile): Promise<T | void> {
  const run = stateWriteQueue.then(async () => {
    const state = readProviderModelState();
    const result = mutate(state);
    await writeProviderModelState(state);
    return result as T;
  });
  // Keep the chain alive even if this step rejected, so later callers still
  // run (each awaits its own `run` and observes its own rejection).
  stateWriteQueue = run.catch(() => undefined);
  return run;
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
  await withStateLock((state) => {
    if (disabled) {
      state.disabled[key] = true;
    } else {
      delete state.disabled[key];
    }
  });
}

/**
 * Persist the result of evaluating newly-seen `providerID::modelID` keys:
 * mark them all as known (so they are never re-evaluated by the
 * fast/old-generation default rule), and record any that the rule decided
 * should default to disabled.
 */
export async function recordKnownModels(input: {
  newlyKnown: string[];
  newlyDisabled: string[];
}): Promise<void> {
  if (input.newlyKnown.length === 0) return;
  await withStateLock((state) => {
    const known = new Set(state.knownModelKeys ?? []);
    for (const key of input.newlyKnown) known.add(key);
    state.knownModelKeys = [...known];
    for (const key of input.newlyDisabled) state.disabled[key] = true;
  });
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
  await withStateLock((state) => {
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
  });
}

export async function setProviderIcon(
  providerID: string,
  icon: string | undefined,
): Promise<void> {
  await withStateLock((state) => {
    const trimmed = icon?.trim();
    if (trimmed) state.providerIcons[providerID] = trimmed;
    else delete state.providerIcons[providerID];
  });
}

/**
 * Drop every WebUI-local trace of a provider that was removed from
 * `opencode.jsonc`: its own disabled flag, all `providerID::modelID`
 * disabled flags, its saved model order, its position in providerOrder,
 * and its icon override.
 */
export async function removeProviderState(providerID: string): Promise<void> {
  await withStateLock((state) => {
    delete state.disabled[providerID];
    const prefix = `${providerID}::`;
    for (const key of Object.keys(state.disabled)) {
      if (key.startsWith(prefix)) delete state.disabled[key];
    }
    state.providerOrder = state.providerOrder.filter((id) => id !== providerID);
    delete state.modelOrder[providerID];
    delete state.providerIcons[providerID];
    if (state.knownModelKeys) {
      state.knownModelKeys = state.knownModelKeys.filter(
        (key) => key !== providerID && !key.startsWith(prefix),
      );
    }
  });
}
