/**
 * Model dropdown ordering shared by Home / Task / Settings composers.
 *
 * Provider groups: OpenAI → Anthropic → Ollama → OpenCode → Cursor → others.
 * Within a provider, models are ordered smartest-first via name heuristics.
 */

export type ModelOption = { value: string; label: string; group: string };
export type ModelOrderPreference = {
  providerOrder?: string[];
  modelOrder?: Record<string, string[]>;
};

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

  const version =
    id.match(/gpt-(\d+)\.(\d+)/) ??
    id.match(/gpt-(\d+)/) ??
    id.match(/claude-[\w]+-(\d+)[.-](\d+)/) ??
    id.match(/claude-[\w]+-(\d+)/) ??
    id.match(/glm-(\d+)\.(\d+)/) ??
    id.match(/glm-(\d+)/) ??
    id.match(/v(\d+)(?:[.-](\d+))?/) ??
    id.match(/(?:^|-)(\d+)\.(\d+)/);

  if (version) {
    const major = Number(version[1]);
    const minor = Number(version[2] ?? 0);
    if (Number.isFinite(major)) score += major * 1_000 + minor * 10;
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
