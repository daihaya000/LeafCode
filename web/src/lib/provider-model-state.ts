import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

export type ModelPricing = {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached-input tokens; defaults to `input` when omitted. */
  cachedInput?: number;
  /** USD per 1M cache-write tokens; defaults to `input` when omitted. */
  cacheWrite?: number;
  /** USD per 1M output tokens. */
  output: number;
};

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
  /**
   * Manual per-model token pricing (`providerID::modelID` → USD per 1M
   * tokens) for models whose cost OpenCode does not report. Used to estimate
   * usage cost in the UI and task list.
   */
  modelPricing: Record<string, ModelPricing>;
  /** Version of the built-in model pricing defaults applied to this state. */
  modelPricingDefaultsVersion: number;
};

const MODEL_PRICING_DEFAULTS_VERSION = 2;

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
  modelPricingDefaultsVersion: MODEL_PRICING_DEFAULTS_VERSION,
  // Default manual pricing for models whose cost is not reported by OpenCode.
  // Ollama Cloud / Qwen Cloud (Alibaba token-plan) do not publish per-token
  // prices, so values below are representative vendor-equivalent prices
  // (mostly from OpenRouter / vendor APIs) in USD per 1M tokens. Users can
  // override via the WebUI.
  modelPricing: {
    // Google: gemma-4-31b-it via OpenRouter
    "ollama-cloud::gemma4": { input: 0.1, output: 0.34 },
    // Alibaba Cloud: qwen3.5-plus (closest public sibling)
    "ollama-cloud::qwen3.5": { input: 0.3, output: 1.8 },
    // OpenAI: gpt-oss-120b via OpenRouter
    "ollama-cloud::gpt-oss": { input: 0.037, output: 0.17 },
    // NVIDIA: nemotron-3-super-120b via OpenRouter
    "ollama-cloud::nemotron-3-super": { input: 0.085, output: 0.4 },
    // MiniMax: minimax-m2.7 via OpenRouter
    "ollama-cloud::minimax-m2.7": { input: 0.3, output: 1.2 },
    // Z.ai: glm-5.1 via OpenRouter
    "ollama-cloud::glm-5.1": { input: 0.952, output: 2.992 },
    // NVIDIA: nemotron-3-nano-30b via OpenRouter
    "ollama-cloud::nemotron-3-nano": { input: 0.05, output: 0.2 },
    // Moonshot AI: kimi-k2.6 via OpenRouter
    "ollama-cloud::kimi-k2.6": { input: 0.5795, output: 2.44 },
    // MiniMax: minimax-m3 via OpenRouter
    "ollama-cloud::minimax-m3": { input: 0.3, output: 1.2 },
    // DeepSeek: deepseek-v4-flash via OpenRouter
    "ollama-cloud::deepseek-v4-flash": { input: 0.14, output: 0.28 },
    // DeepSeek: deepseek-v4-pro via OpenRouter
    "ollama-cloud::deepseek-v4-pro": { input: 0.435, output: 0.87 },
    // Z.ai: glm-5.2 via OpenRouter
    "ollama-cloud::glm-5.2": { input: 0.5026, output: 1.5796 },
    // Moonshot AI: kimi-k2.7-code via OpenRouter
    "ollama-cloud::kimi-k2.7-code": { input: 0.7, output: 3.5 },
    // Mistral AI: mistral-large-2512 (closest public Large v3 successor)
    "ollama-cloud::mistral-large-3": { input: 0.5, output: 1.5 },
    // NVIDIA: nemotron-3-ultra-550b via OpenRouter
    "ollama-cloud::nemotron-3-ultra": { input: 0.6, output: 3.6 },
    // Moonshot AI: kimi-k3 from Ollama Cloud pricing page
    "ollama-cloud::kimi-k3": { input: 3, cachedInput: 0.3, output: 15 },
    // Qwen Cloud (Alibaba token-plan). Base price tier up to 256K context.
    // Alibaba Cloud: qwen3.8-max (official international pricing)
    "qwen-cloud::qwen3.8-max": {
      input: 2,
      cachedInput: 0.25,
      cacheWrite: 2.5,
      output: 6,
    },
    // Alibaba Cloud: qwen3.7-max (official international pricing)
    "qwen-cloud::qwen3.7-max": {
      input: 2.5,
      cachedInput: 0.5,
      cacheWrite: 3.125,
      output: 7.5,
    },
    // Alibaba Cloud: qwen3.7-plus (official international pricing)
    "qwen-cloud::qwen3.7-plus": {
      input: 0.5,
      cachedInput: 0.05,
      cacheWrite: 0.625,
      output: 3,
    },
    // Alibaba Cloud: qwen3.6-flash (official international pricing)
    "qwen-cloud::qwen3.6-flash": {
      input: 0.1875,
      cacheWrite: 0.234375,
      output: 1.125,
    },
    // Z.ai: glm-5.2 via OpenRouter
    "qwen-cloud::glm-5.2": { input: 0.63, cachedInput: 0.0945, output: 1.98 },
    // DeepSeek: deepseek-v4-pro (official DeepSeek pricing)
    "qwen-cloud::deepseek-v4-pro": {
      input: 0.435,
      cachedInput: 0.003625,
      output: 0.87,
    },
    // DeepSeek: deepseek-v4-flash-0731 (official DeepSeek pricing)
    "qwen-cloud::deepseek-v4-flash-0731": {
      input: 0.14,
      cachedInput: 0.0028,
      output: 0.28,
    },
  },
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
    modelPricing: Object.fromEntries(
      Object.entries(DEFAULT_STATE.modelPricing).map(([key, pricing]) => [
        key,
        { ...pricing },
      ]),
    ),
    modelPricingDefaultsVersion: MODEL_PRICING_DEFAULTS_VERSION,
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
      const modelPricing: Record<string, ModelPricing> = {};
      if (
        parsed.modelPricing &&
        typeof parsed.modelPricing === "object" &&
        !Array.isArray(parsed.modelPricing)
      ) {
        for (const [key, value] of Object.entries(parsed.modelPricing)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          const price = value as Record<string, unknown>;
          const input = typeof price.input === "number" ? price.input : NaN;
          const output = typeof price.output === "number" ? price.output : NaN;
          if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
          const cachedInput =
            typeof price.cachedInput === "number" ? price.cachedInput : undefined;
          const cacheWrite =
            typeof price.cacheWrite === "number" ? price.cacheWrite : undefined;
          modelPricing[key] = {
            input,
            output,
            ...(Number.isFinite(cachedInput) ? { cachedInput } : {}),
            ...(Number.isFinite(cacheWrite) ? { cacheWrite } : {}),
          };
        }
      }
      const storedPricingDefaultsVersion =
        typeof parsed.modelPricingDefaultsVersion === "number" &&
        Number.isInteger(parsed.modelPricingDefaultsVersion)
          ? parsed.modelPricingDefaultsVersion
          : 0;
      if (storedPricingDefaultsVersion < MODEL_PRICING_DEFAULTS_VERSION) {
        for (const [key, pricing] of Object.entries(DEFAULT_STATE.modelPricing)) {
          if (!modelPricing[key]) modelPricing[key] = { ...pricing };
        }
      }
      return {
        disabled,
        providerOrder,
        modelOrder,
        providerIcons,
        knownModelKeys,
        modelPricing,
        modelPricingDefaultsVersion: MODEL_PRICING_DEFAULTS_VERSION,
      };
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
 * Set or clear a manual per-model pricing entry (`providerID::modelID`).
 * Passing `undefined` removes the entry. Used to estimate usage cost for
 * models whose cost OpenCode does not report.
 */
export async function setModelPricing(
  key: string,
  pricing: ModelPricing | undefined,
): Promise<void> {
  await withStateLock((state) => {
    if (pricing) state.modelPricing[key] = pricing;
    else delete state.modelPricing[key];
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
    delete state.modelPricing[providerID];
    const pricingPrefix = `${providerID}::`;
    for (const key of Object.keys(state.modelPricing)) {
      if (key.startsWith(pricingPrefix)) delete state.modelPricing[key];
    }
    if (state.knownModelKeys) {
      state.knownModelKeys = state.knownModelKeys.filter(
        (key) => key !== providerID && !key.startsWith(prefix),
      );
    }
  });
}
