import fs from "node:fs";
import path from "node:path";
import { ocServer } from "../oc-server";
import type { ProviderModelsDto } from "../extensions";
import { formatModelLabel, sortModelOptions } from "../model-options";
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
  setProviderModelOrder,
  setProviderModelDisabled,
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
  models?: Record<string, ProviderConfigModel>;
};

type CustomProviderInput = {
  id: string;
  name: string;
  baseURL: string;
  apiKeyEnv?: string;
  npm?: string;
  models: { id: string; name?: string }[];
};

type ProviderResponse = {
  all: {
    id: string;
    name: string;
    models: Record<string, { name?: string }>;
  }[];
  connected: string[];
  default: Record<string, string>;
};

/**
 * List all providers and their models, merged with the WebUI-local
 * disabled state. Only connected providers are included when the
 * `connected` list is non-empty.
 */
export async function listProviderModels(): Promise<ProviderModelsDto[]> {
  const data = await ocServer<ProviderResponse>(null, "/provider", {
    timeoutMs: 3000,
  });

  const state = readProviderModelState();
  const disabled = state.disabled;
  const configured = configuredProvidersFromContent(
    readConfigContentForProviders(),
    disabled,
  );

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
    const models = modelEntries.map(([modelID, model]) => ({
      id: modelID,
      name: formatModelLabel(model.name, modelID),
      enabled: providerEnabled && !disabled[`${id}::${modelID}`],
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
      };
    });

    providers.push({
      id,
      name: p.name || id,
      enabled: providerEnabled,
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
        models,
      },
    ];
  });
}

function mergeConfiguredProviders(
  providers: ProviderModelsDto[],
  configured: ProviderModelsDto[],
): ProviderModelsDto[] {
  const existing = new Set(providers.map((provider) => provider.id));
  const missing = configured.filter((provider) => !existing.has(provider.id));
  return missing.length === 0 ? providers : [...providers, ...missing];
}

function validateIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ExtensionsError("invalid-name", `${label}を入力してください`);
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new ExtensionsError("invalid-name", `${label}は英数字、._- のみ使用できます`);
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
  const models = input.models.map((model) => {
    const modelID = validateIdentifier(model.id, "モデルID");
    return [modelID, { name: model.name?.trim() || modelID }];
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

export async function addCustomProvider(input: CustomProviderInput): Promise<void> {
  const { id, config } = providerConfigFromInput(input);
  const filePath = opencodeConfigFilePath();
  if (!fs.existsSync(filePath)) {
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
}

export async function saveProviderModelOrder(input: {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
}): Promise<void> {
  await setProviderModelOrder(input);
}
