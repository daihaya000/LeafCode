/**
 * Model dropdown ordering shared by Home / Task / Settings composers.
 *
 * Provider groups: OpenAI → Anthropic → Ollama → OpenCode → Cursor → others.
 * Within a provider, models are ordered smartest-first via name heuristics.
 */

export type ModelOption = {
  value: string;
  label: string;
  group: string;
  /** True when the model accepts direct image or attachment inputs. */
  image?: boolean;
};
export type ModelOrderPreference = {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
};

export function mergeConfiguredModelOptions<T extends ModelOption>(
  options: T[],
  providers: {
    id: string;
    name: string;
    enabled?: boolean;
    models?: { id: string; name?: string; enabled?: boolean }[];
  }[] | undefined | null,
): T[] {
  if (!providers || providers.length === 0) return options;

  const merged = [...options];
  const known = new Set(options.map((option) => option.value));
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    for (const model of provider.models ?? []) {
      const value = `${provider.id}::${model.id}`;
      if (model.enabled === false || known.has(value)) continue;
      known.add(value);
      merged.push({
        value,
        label: formatModelLabel(model.name, model.id),
        group: provider.name || provider.id,
      } as T);
    }
  }
  return merged;
}

export function modelOrderPreferenceFromProviders(
  providers: { id: string; models?: { id: string }[] }[] | undefined | null,
): ModelOrderPreference | undefined {
  if (!providers || providers.length === 0) return undefined;
  return {
    providerOrder: providers.map((provider) => provider.id),
    modelOrder: Object.fromEntries(
      providers.map((provider) => [
        provider.id,
        (provider.models ?? []).map((model) => model.id),
      ]),
    ),
  };
}

export function filterEnabledModelOptions<T extends ModelOption>(
  options: T[],
  providers: {
    id: string;
    enabled?: boolean;
    models?: { id: string; enabled?: boolean }[];
  }[] | undefined | null,
): T[] {
  if (!providers || providers.length === 0) return options;
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  return options.filter((option) => {
    const { providerID, modelID } = parseOptionValue(option.value);
    const provider = providerMap.get(providerID);
    if (!provider) return true;
    if (provider.enabled === false) return false;
    const model = provider.models?.find((item) => item.id === modelID);
    return model?.enabled !== false;
  });
}

/**
 * Normalize OpenCode provider model display names for the dropdown.
 * Upstream sometimes tags a single alias (e.g. Claude Haiku) with
 * trailing "(latest)" while sibling models omit it — strip that marker
 * so labels stay consistent. Value / modelID are left untouched.
 */
export function formatModelLabel(name: string | undefined | null, fallback: string): string {
  const raw = (name?.trim() || fallback).trim();
  return raw.replace(/\s*\(\s*latest\s*\)\s*$/i, "").trim() || fallback;
}

/** Canonical provider priority (lower = earlier in the dropdown). */
const PROVIDER_PRIORITY: Record<string, number> = {
  openai: 0,
  anthropic: 1,
  ollama: 2,
  opencode: 3,
  cursor: 4,
};

/**
 * Map OpenCode provider ids (and common aliases) onto the five UI buckets.
 * Unknown providers sort after the known set, alphabetically.
 */
export function normalizeProviderBucket(providerID: string): string {
  const id = providerID.toLowerCase();
  if (id === "openai" || id.startsWith("openai-")) return "openai";
  if (id === "anthropic" || id.startsWith("anthropic-") || id === "claude") {
    return "anthropic";
  }
  if (id === "ollama" || id.startsWith("ollama")) return "ollama";
  if (id === "opencode" || id.startsWith("opencode")) return "opencode";
  if (id === "cursor" || id.startsWith("cursor")) return "cursor";
  return id;
}

export function providerSortKey(providerID: string): number {
  const bucket = normalizeProviderBucket(providerID);
  const known = PROVIDER_PRIORITY[bucket];
  if (known !== undefined) return known;
  // Stable tail: keep unknown providers after the known five.
  return 100;
}

/**
 * Higher score = earlier in the dropdown.
 * GPT: Sol → Terra → Luna → 5.5. Claude: fable/opus/sonnet/haiku.
 * Ollama/OpenCode cloud coding ability (OpenCode/Codex 系の目安):
 * GLM → DeepSeek Pro → Kimi → DeepSeek Flash.
 */
/**
 * Extract a `[major, minor]` version pair from a model id, using the same
 * heuristics `modelIntelligenceScore` uses for ordering. Returns `null` when
 * no version-like pattern is found.
 */
export function parseModelVersion(modelID: string): [number, number] | null {
  const id = modelID.toLowerCase().replaceAll("_", "-");
  const version =
    id.match(/gpt-(\d+)\.(\d+)/) ??
    id.match(/gpt-(\d+)/) ??
    id.match(/claude-[\w]+-(\d+)[.-](\d+)/) ??
    id.match(/claude-[\w]+-(\d+)/) ??
    id.match(/glm-(\d+)\.(\d+)/) ??
    id.match(/glm-(\d+)/) ??
    id.match(/v(\d+)(?:[.-](\d+))?/) ??
    id.match(/(?:^|-)(\d+)\.(\d+)/);
  if (!version) return null;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? 0);
  if (!Number.isFinite(major)) return null;
  return [major, minor];
}

/**
 * True when a model id is a "fast"/speed-optimized variant (e.g.
 * `gpt-5.6-sol-fast`, `claude-opus-5-fast`). Matched as a delimited token so
 * unrelated ids like `fastly-model` are not flagged.
 */
export function isFastModelId(modelID: string): boolean {
  const id = modelID.toLowerCase().replaceAll("_", "-");
  return /(^|[^a-z0-9])fast([^a-z0-9]|$)/.test(id);
}

/**
 * Decide whether a newly-discovered model should default to disabled:
 * "fast" variants, and models whose version is 2+ generations behind the
 * newest version seen among its provider siblings, default off. Models
 * without a parseable version are left enabled (can't judge staleness).
 *
 * `siblingModelIDs` should include every model id returned for the same
 * provider (including the model itself) so the newest version can be
 * determined.
 */
export function shouldDefaultDisableModel(
  modelID: string,
  siblingModelIDs: string[],
): boolean {
  if (isFastModelId(modelID)) return true;
  const version = parseModelVersion(modelID);
  if (!version) return false;
  const distinctVersions = Array.from(
    new Set(
      siblingModelIDs
        .map((id) => parseModelVersion(id))
        .filter((v): v is [number, number] => v !== null)
        .map(([major, minor]) => `${major}.${minor}`),
    ),
  )
    .map((key): [number, number] => {
      const [major, minor] = key.split(".").map(Number);
      return [major, minor];
    })
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const rank = distinctVersions.findIndex(
    ([major, minor]) => major === version[0] && minor === version[1],
  );
  // 2 or more generations older than the newest sibling version.
  return rank >= 2;
}

export function modelIntelligenceScore(modelID: string): number {
  const id = modelID.toLowerCase().replaceAll("_", "-");
  let score = 0;

  if (/gpt-/.test(id)) {
    score += 400_000;
    // Preferred order: Sol → Terra → Luna → 5.5 (and other non-codename GPT)
    if (/\bsol\b/.test(id)) score += 100_000;
    else if (/\bterra\b/.test(id)) score += 80_000;
    else if (/\bluna\b/.test(id)) score += 40_000;
    else score += 10_000; // e.g. gpt-5.5 after the 5.6 codenames
  } else if (/claude-/.test(id)) {
    score += 400_000;
    if (id.includes("fable")) score += 120_000;
    else if (id.includes("opus")) score += 100_000;
    else if (id.includes("sonnet")) score += 60_000;
    else if (id.includes("haiku")) score += 20_000;
  } else if (/\bo[1-9]\b/.test(id) || /^o[1-9]/.test(id)) {
    score += 390_000;
  } else if (/glm-/.test(id)) {
    // Above DeepSeek Pro (base+pro ≈ 350k) for coding-ability order
    score += 360_000;
  } else if (/deepseek/.test(id)) {
    score += 300_000;
  } else if (/kimi/.test(id)) {
    score += 280_000;
  } else if (/composer/.test(id)) {
    score += 260_000;
  } else if (id === "auto") {
    score += 200_000;
  }

  if (/\bpro\b/.test(id)) score += 50_000;
  if (/\bmax\b/.test(id)) score += 60_000;
  if (/\bultra\b/.test(id)) score += 70_000;
  if (/\bflash\b/.test(id)) score -= 40_000;
  if (/\bmini\b/.test(id)) score -= 50_000;
  if (/\bnano\b/.test(id)) score -= 70_000;
  if (/\bfast\b/.test(id)) score -= 20_000;
  if (/\blite\b/.test(id)) score -= 30_000;

  const version = parseModelVersion(id);
  if (version) {
    const [major, minor] = version;
    score += major * 1_000 + minor * 10;
  }

  return score;
}

function parseOptionValue(value: string): { providerID: string; modelID: string } {
  const sep = value.indexOf("::");
  if (sep <= 0) return { providerID: value, modelID: value };
  return {
    providerID: value.slice(0, sep),
    modelID: value.slice(sep + 2),
  };
}

/** Sort model options: saved order first, then provider bucket / intelligence / label. */
export function sortModelOptions<T extends ModelOption>(
  options: T[],
  order?: ModelOrderPreference,
): T[] {
  const providerIndex = new Map(
    (order?.providerOrder ?? []).map((providerID, index) => [providerID, index]),
  );
  const modelIndex = new Map<string, Map<string, number>>();
  for (const [providerID, models] of Object.entries(order?.modelOrder ?? {})) {
    modelIndex.set(
      providerID,
      new Map(models.map((modelID, index) => [modelID, index])),
    );
  }
  return [...options].sort((a, b) => {
    const pa = parseOptionValue(a.value);
    const pb = parseOptionValue(b.value);
    const providerOrderA = providerIndex.get(pa.providerID);
    const providerOrderB = providerIndex.get(pb.providerID);
    if (providerOrderA !== undefined || providerOrderB !== undefined) {
      const diff =
        (providerOrderA ?? Number.MAX_SAFE_INTEGER) -
        (providerOrderB ?? Number.MAX_SAFE_INTEGER);
      if (diff !== 0) return diff;
    }
    const providerDiff =
      providerSortKey(pa.providerID) - providerSortKey(pb.providerID);
    if (providerDiff !== 0) return providerDiff;
    // Same bucket but different raw ids (e.g. ollama vs ollama-cloud): keep
    // provider id alphabetical so groups stay contiguous.
    if (pa.providerID !== pb.providerID) {
      return pa.providerID.localeCompare(pb.providerID);
    }
    const modelOrderA = modelIndex.get(pa.providerID)?.get(pa.modelID);
    const modelOrderB = modelIndex.get(pb.providerID)?.get(pb.modelID);
    if (modelOrderA !== undefined || modelOrderB !== undefined) {
      const diff =
        (modelOrderA ?? Number.MAX_SAFE_INTEGER) -
        (modelOrderB ?? Number.MAX_SAFE_INTEGER);
      if (diff !== 0) return diff;
    }
    const scoreDiff =
      modelIntelligenceScore(pb.modelID) - modelIntelligenceScore(pa.modelID);
    if (scoreDiff !== 0) return scoreDiff;
    return a.label.localeCompare(b.label);
  });
}
