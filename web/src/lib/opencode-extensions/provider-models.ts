import type { ProviderModelsDto } from "../extensions";
import { ocServer } from "../oc-server";
import { formatModelLabel, sortModelOptions } from "../model-options";
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

export async function saveProviderModelOrder(input: {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
}): Promise<void> {
  await setProviderModelOrder(input);
}
