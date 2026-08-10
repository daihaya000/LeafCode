import fs from "node:fs";
import path from "node:path";
import { ocServer } from "../oc-server";
import type { ProviderModelsDto } from "../extensions";
import {
  formatModelLabel,
  shouldDefaultDisableModel,
  sortModelOptions,
} from "../model-options";
import {
  applyEdits,
  detectFormatting,
  modify,
  parseJsoncConfig,
  readConfigContent,
  updateConfigFile,
} from "./jsonc-edit";
import { opencodeConfigFilePath } from "./paths";
import { ExtensionsError } from "./safe-move";
import {
  readProviderModelState,
  recordKnownModels,
  setProviderModelOrder,
  setProviderModelDisabled,
  setProviderIcon,
  removeProviderState,
} from "../provider-model-state";

/**
 * Shape returned by OpenCode's GET /provider endpoint.
 * Matches the schema: `all` is an array of Provider objects,
 * each with `id`, `name`, and `models` (Record<modelID, Model>).
 */
type ProviderConfigModel = {
  name?: string;
};

type ProviderConfigEntry = {
  name?: string;
  npm?: string;
  options?: { baseURL?: string; apiKey?: string };
  models?: Record<string, ProviderConfigModel>;
};

type CustomProviderInput = {
  id: string;
  name: string;
  baseURL: string;
  apiKeyEnv?: string;
  icon?: string;
  npm?: string;
  models: { id: string; name?: string }[];
};

type ProviderResponse = {
  all: {
    id: string;
    name: string;
    models: Record<
      string,
      {
        name?: string;
        capabilities?: {
          attachment?: boolean;
          input?: {
            text?: boolean;
            audio?: boolean;
            image?: boolean;
            video?: boolean;
            pdf?: boolean;
          };
        };
        variants?: Record<string, { disabled?: boolean } | undefined>;
      }
    >;
  }[];
  connected: string[];
  default: Record<string, string>;
};

/**
 * OpenCode's `/provider` response is stable for seconds at a time, and Home
 * fetches both `/api/opencode/provider` (the transparent proxy) and this
 * endpoint in the same `Promise.all` burst. Caching the raw upstream result
 * for a short TTL collapses the second call into an in-memory hit, cutting
 * the worst-case Home boot latency roughly in half without affecting the
 * per-model disabled state (which is recomputed from disk on every call).
 */
const PROVIDER_RESPONSE_CACHE_TTL_MS = 5_000;
let providerResponseCache: { at: number; data: ProviderResponse } | null =
  null;

/** Test-only: drop the in-memory `/provider` cache between tests. */
export function __clearProviderResponseCacheForTest(): void {
  providerResponseCache = null;
}

async function fetchProviderResponse(): Promise<ProviderResponse> {
  const now = Date.now();
  const cached = providerResponseCache;
  if (cached && now - cached.at < PROVIDER_RESPONSE_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await ocServer<ProviderResponse>(null, "/provider", {
    timeoutMs: 3000,
  });
  providerResponseCache = {
    at: now,
    data,
  };
  return data;
}

/**
 * List all providers and their models, merged with the WebUI-local
 * disabled state. Only connected providers are included when the
 * `connected` list is non-empty.
 */
export async function listProviderModels(): Promise<ProviderModelsDto[]> {
  const data = await fetchProviderResponse();

  const state = readProviderModelState();
  // Mutable copy: newly-discovered models may get an automatic default
  // (disabled) applied below, reflected immediately in this response.
  const disabled = { ...state.disabled };
  const configured = configuredProvidersFromContent(
    readConfigContentForProviders(),
    disabled,
    state.providerIcons,
  );

  // `knownModelKeys` missing entirely means this state file predates the
  // field: grandfather in every model this profile can currently see so
  // upgrading never flips a model that was implicitly enabled before.
  const legacyGrandfather = state.knownModelKeys === undefined;
  const known = new Set(state.knownModelKeys ?? []);
  const newlyKnown: string[] = [];
  const newlyDisabled: string[] = [];

  // Determine which providers to include.
  const connectedSet =
    data.connected.length > 0 ? new Set(data.connected) : null;

  const providers: ProviderModelsDto[] = [];

  for (const p of data.all) {
    const id = p.id;
    if (!id) continue;
    if (connectedSet && !connectedSet.has(id)) continue;

    const providerEnabled = !disabled[id];

    const modelEntries = Object.entries(p.models ?? {});
    const siblingModelIDs = modelEntries.map(([modelID]) => modelID);
    for (const modelID of siblingModelIDs) {
      const key = `${id}::${modelID}`;
      if (known.has(key)) continue;
      newlyKnown.push(key);
      if (legacyGrandfather || disabled[key] !== undefined) continue;
      if (shouldDefaultDisableModel(modelID, siblingModelIDs)) {
        disabled[key] = true;
        newlyDisabled.push(key);
      }
    }

    const models = modelEntries.map(([modelID, model]) => ({
      id: modelID,
      name: formatModelLabel(model.name, modelID),
      enabled: providerEnabled && !disabled[`${id}::${modelID}`],
      pricing: state.modelPricing[`${id}::${modelID}`],
      capabilities: model.capabilities
        ? {
            attachment: model.capabilities.attachment,
            input: model.capabilities.input,
          }
        : undefined,
      variants: model.variants,
    }));

    // Sort models using saved order first, then existing intelligence ordering.
    const savedModelOrder = state.modelOrder[id] ?? [];
    const sortedModels = sortModelOptions(
      models.map((m) => ({
        value: `${id}::${m.id}`,
        label: m.name,
        group: id,
      })),
      { modelOrder: { [id]: savedModelOrder } },
    ).map((opt) => {
      const modelID = opt.value.slice(opt.value.indexOf("::") + 2);
      return models.find((m) => m.id === modelID) ?? {
        id: modelID,
        name: opt.label,
        enabled: providerEnabled && !disabled[`${id}::${modelID}`],
        pricing: state.modelPricing[`${id}::${modelID}`],
      };
    });

    providers.push({
      id,
      name: p.name || id,
      enabled: providerEnabled,
      icon: state.providerIcons[id],
      models: sortedModels,
    });
  }

  providers.splice(0, providers.length, ...mergeConfiguredProviders(providers, configured));

  // Sort providers using saved order first, then alphabetically by name.
  const providerIndex = new Map(state.providerOrder.map((id, index) => [id, index]));
  providers.sort((a, b) => {
    const ai = providerIndex.get(a.id);
    const bi = providerIndex.get(b.id);
    if (ai !== undefined || bi !== undefined) {
      return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER);
    }
    return a.name.localeCompare(b.name);
  });

  if (newlyKnown.length > 0) {
    await recordKnownModels({ newlyKnown, newlyDisabled }).catch((err) => {
      console.warn("[provider-model] 新規モデルの既定状態を保存できません", err);
    });
  }

  return providers;
}

/**
 * Toggle a provider or model's enabled state in the WebUI-local state file.
 * `key` is `providerID` or `providerID::modelID`.
 * No changes are made to OpenCode config files.
 */
export async function setProviderModelEnabled(
  key: string,
  enabled: boolean,
): Promise<void> {
  await setProviderModelDisabled(key, !enabled);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readConfigContentForProviders(): string {
  try {
    return readConfigContent(opencodeConfigFilePath());
  } catch {
    return "{}";
  }
}

function configuredProvidersFromContent(
  content: string,
  disabled: Record<string, true>,
  providerIcons: Record<string, string>,
): ProviderModelsDto[] {
  const root = parseJsoncConfig(content);
  if (root.provider === undefined) return [];
  if (!isRecord(root.provider)) {
    throw new ExtensionsError("config", "provider 設定が不正です");
  }
  return Object.entries(root.provider).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const entry = raw as ProviderConfigEntry;
    const providerEnabled = !disabled[id];
    const models = isRecord(entry.models)
      ? Object.entries(entry.models).map(([modelID, model]) => ({
          id: modelID,
          name: formatModelLabel(
            isRecord(model) && typeof model.name === "string"
              ? model.name
              : undefined,
            modelID,
          ),
          enabled: providerEnabled && !disabled[`${id}::${modelID}`],
        }))
      : [];
    return [
      {
        id,
        name: typeof entry.name === "string" && entry.name ? entry.name : id,
        enabled: providerEnabled,
        editable: true,
        icon: providerIcons[id],
        baseURL:
          isRecord(entry.options) && typeof entry.options.baseURL === "string"
            ? entry.options.baseURL
            : undefined,
        apiKeyEnv:
          isRecord(entry.options) && typeof entry.options.apiKey === "string"
            ? envNameFromRef(entry.options.apiKey)
            : undefined,
        npm: typeof entry.npm === "string" ? entry.npm : undefined,
        models,
      },
    ];
  });
}

/**
 * `opencode.jsonc` に直接定義された画像対応モデル一覧。
 * OpenCode の `/provider` が `connected` に載せないローカルプロバイダー
 * （登録済みの Ollama など）でも画像解析の選択肢として提示するために使う。
 */
export function listConfiguredImageModels(): {
  value: string;
  label: string;
  group: string;
}[] {
  const root = parseJsoncConfig(readConfigContentForProviders());
  if (!isRecord(root.provider)) return [];
  return Object.entries(root.provider).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const providerName =
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    if (!isRecord(raw.models)) return [];
    return Object.entries(raw.models).flatMap(([modelID, model]) => {
      if (!isRecord(model)) return [];
      const modalities = isRecord(model.modalities) ? model.modalities : null;
      const inputs = Array.isArray(modalities?.input) ? modalities.input : [];
      if (model.attachment !== true && !inputs.includes("image")) return [];
      return [
        {
          value: `${id}::${modelID}`,
          label:
            typeof model.name === "string" && model.name.trim()
              ? model.name.trim()
              : modelID,
          group: providerName,
        },
      ];
    });
  });
}

function envNameFromRef(value: string): string | undefined {
  const match = value.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return match?.[1];
}

function mergeConfiguredProviders(
  providers: ProviderModelsDto[],
  configured: ProviderModelsDto[],
): ProviderModelsDto[] {
  const configuredById = new Map(configured.map((provider) => [provider.id, provider]));
  const merged = providers.map((provider) => {
    const config = configuredById.get(provider.id);
    if (!config) return provider;
    return {
      ...provider,
      editable: true,
      icon: config.icon,
      baseURL: config.baseURL,
      apiKeyEnv: config.apiKeyEnv,
      npm: config.npm,
    };
  });
  const existing = new Set(merged.map((provider) => provider.id));
  const missing = configured.filter((provider) => !existing.has(provider.id));
  return missing.length === 0 ? merged : [...merged, ...missing];
}

function validateIdentifier(
  value: string,
  label: string,
  extraChars = "",
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ExtensionsError("invalid-name", `${label}を入力してください`);
  const pattern = new RegExp(`^[A-Za-z0-9.${extraChars}_-]+$`);
  if (!pattern.test(trimmed)) {
    const allowed = extraChars ? `._-${extraChars}` : "._-";
    throw new ExtensionsError("invalid-name", `${label}は英数字、${allowed} のみ使用できます`);
  }
  return trimmed;
}

function validateEnvName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new ExtensionsError("invalid-name", "APIキー環境変数名が不正です");
  }
  return trimmed;
}

function validateIcon(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  throw new ExtensionsError("invalid-name", "アイコンは http(s) URL または / から始まるパスで入力してください");
}

/**
 * フォームで表現できないモデル定義（画像入力対応・コスト・コンテキスト長など）は
 * UI編集で失わせない。編集フォームは `id` と表示名しか持たないため、同じIDの
 * 既存エントリからこれらのフィールドを引き継ぐ。
 */
const PRESERVED_MODEL_FIELDS = [
  "attachment",
  "modalities",
  "reasoning",
  "temperature",
  "tool_call",
  "interleaved",
  "cost",
  "limit",
  "family",
  "release_date",
  "options",
  "headers",
  "status",
] as const;

function preservedModelFields(
  existing: unknown,
): Record<string, unknown> {
  if (!isRecord(existing)) return {};
  const kept: Record<string, unknown> = {};
  for (const field of PRESERVED_MODEL_FIELDS) {
    if (existing[field] !== undefined) kept[field] = existing[field];
  }
  return kept;
}

function existingProviderModels(providerID: string): Record<string, unknown> {
  const root = parseJsoncConfig(readConfigContentForProviders());
  if (!isRecord(root.provider)) return {};
  const entry = root.provider[providerID];
  if (!isRecord(entry) || !isRecord(entry.models)) return {};
  return entry.models;
}

function providerConfigFromInput(input: CustomProviderInput): {
  id: string;
  config: Record<string, unknown>;
} {
  const id = validateIdentifier(input.id, "プロバイダーID");
  const name = input.name.trim();
  if (!name) throw new ExtensionsError("invalid-name", "表示名を入力してください");
  const baseURL = input.baseURL.trim();
  if (!/^https?:\/\//.test(baseURL)) {
    throw new ExtensionsError("invalid-name", "Base URL は http:// または https:// で入力してください");
  }
  const previousModels = existingProviderModels(id);
  const models = input.models.map((model) => {
    // Ollama のタグ付きモデルID（`qwen2.5vl:7b`）を通すため `:` も許可する。
    const modelID = validateIdentifier(model.id, "モデルID", "/:");
    return [
      modelID,
      {
        name: model.name?.trim() || modelID,
        ...preservedModelFields(previousModels[modelID]),
      },
    ];
  });
  if (models.length === 0) {
    throw new ExtensionsError("invalid-name", "モデルを1つ以上入力してください");
  }
  const modelIDs = new Set(models.map(([modelID]) => modelID));
  if (modelIDs.size !== models.length) {
    throw new ExtensionsError("invalid-name", "モデルIDが重複しています");
  }

  const options: Record<string, unknown> = { baseURL };
  const apiKeyEnv = validateEnvName(input.apiKeyEnv);
  if (apiKeyEnv) options.apiKey = `{env:${apiKeyEnv}}`;
  validateIcon(input.icon);

  return {
    id,
    config: {
      npm: input.npm?.trim() || "@ai-sdk/openai-compatible",
      name,
      options,
      models: Object.fromEntries(models),
    },
  };
}

async function ensureConfigFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises
    .writeFile(
      filePath,
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
      { encoding: "utf8", flag: "wx" },
    )
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
}

/**
 * `provider.<id>` を作成または上書きする（存在しても衝突エラーにしない）。
 * 検出したモデル一覧を丸ごと入れ替えるローカル Ollama 登録などで使う。
 */
export async function upsertProviderEntry(
  providerID: string,
  config: Record<string, unknown>,
): Promise<void> {
  const id = validateIdentifier(providerID, "プロバイダーID");
  const filePath = opencodeConfigFilePath();
  await ensureConfigFile(filePath);
  await updateConfigFile(filePath, (content) => {
    const root = parseJsoncConfig(content);
    if (root.provider !== undefined && !isRecord(root.provider)) {
      throw new ExtensionsError("config", "provider 設定が不正です");
    }
    const edits = modify(content, ["provider", id], config, {
      formattingOptions: detectFormatting(content),
    });
    return applyEdits(content, edits);
  });
}

export async function addCustomProvider(input: CustomProviderInput): Promise<void> {
  const { id, config } = providerConfigFromInput(input);
  const filePath = opencodeConfigFilePath();
  await ensureConfigFile(filePath);
  await updateConfigFile(filePath, (content) => {
    const root = parseJsoncConfig(content);
    if (root.provider !== undefined && !isRecord(root.provider)) {
      throw new ExtensionsError("config", "provider 設定が不正です");
    }
    if (isRecord(root.provider) && root.provider[id] !== undefined) {
      throw new ExtensionsError("conflict", "同じIDのプロバイダーが既に存在します");
    }
    const edits = modify(content, ["provider", id], config, {
      formattingOptions: detectFormatting(content),
    });
    return applyEdits(content, edits);
  });
  await setProviderIcon(id, validateIcon(input.icon));
}

export async function updateCustomProvider(
  providerID: string,
  input: CustomProviderInput,
): Promise<void> {
  const id = validateIdentifier(providerID, "プロバイダーID");
  const parsed = providerConfigFromInput({ ...input, id });
  const filePath = opencodeConfigFilePath();
  await updateConfigFile(filePath, (content) => {
    const root = parseJsoncConfig(content);
    if (!isRecord(root.provider) || !isRecord(root.provider[id])) {
      throw new ExtensionsError("not-found", "編集できるプロバイダー設定が見つかりません");
    }
    const edits = modify(content, ["provider", id], parsed.config, {
      formattingOptions: detectFormatting(content),
    });
    return applyEdits(content, edits);
  });
  await setProviderIcon(id, validateIcon(input.icon));
}

/**
 * Remove a provider's `provider.<id>` entry from `opencode.jsonc` (custom
 * providers, or config overrides of a built-in provider) and clean up its
 * WebUI-local state (disabled flags, order, icon override). Built-in
 * providers with no config entry cannot be deleted this way — they keep
 * coming from OpenCode's `/provider` endpoint regardless.
 */
export async function deleteCustomProvider(providerID: string): Promise<void> {
  const id = validateIdentifier(providerID, "プロバイダーID");
  const filePath = opencodeConfigFilePath();
  await updateConfigFile(filePath, (content) => {
    const root = parseJsoncConfig(content);
    if (!isRecord(root.provider) || root.provider[id] === undefined) {
      throw new ExtensionsError("not-found", "削除できるプロバイダー設定が見つかりません");
    }
    const edits = modify(content, ["provider", id], undefined, {
      formattingOptions: detectFormatting(content),
    });
    return applyEdits(content, edits);
  });
  await removeProviderState(id);
}

/**
 * Set or clear a WebUI-local icon override for any provider (built-in or
 * custom). Unlike `updateCustomProvider`, this does not touch
 * `opencode.jsonc` and works even for providers that are not defined in the
 * config (e.g. built-in `openai`/`anthropic`).
 */
export async function setProviderIconOverride(
  providerID: string,
  icon: string | null | undefined,
): Promise<void> {
  const id = validateIdentifier(providerID, "プロバイダーID");
  await setProviderIcon(id, validateIcon(icon ?? undefined));
}

export async function saveProviderModelOrder(input: {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
}): Promise<void> {
  await setProviderModelOrder(input);
}
