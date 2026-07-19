/**
 * Model dropdown ordering shared by Home / Task / Settings composers.
 *
 * Provider groups: OpenAI → Anthropic → Ollama → OpenCode → Cursor → others.
 * Within a provider, models are ordered smartest-first via name heuristics.
 */

export type ModelOption = { value: string; label: string; group: string };

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
 * Higher score = smarter. Tuned for current frontier naming
 * (GPT-5.6 sol/terra/luna, Claude fable/opus/sonnet/haiku, etc.).
 */
export function modelIntelligenceScore(modelID: string): number {
  const id = modelID.toLowerCase().replaceAll("_", "-");
  let score = 0;

  if (/gpt-/.test(id)) {
    score += 400_000;
    if (/\bsol\b/.test(id)) score += 100_000;
    else if (/\bterra\b/.test(id)) score += 40_000;
    else if (/\bluna\b/.test(id)) score += 10_000;
    else score += 80_000; // e.g. gpt-5.5 ≈ flagship of that line
  } else if (/claude-/.test(id)) {
    score += 400_000;
    if (id.includes("fable")) score += 120_000;
    else if (id.includes("opus")) score += 100_000;
    else if (id.includes("sonnet")) score += 60_000;
    else if (id.includes("haiku")) score += 20_000;
  } else if (/\bo[1-9]\b/.test(id) || /^o[1-9]/.test(id)) {
    score += 390_000;
  } else if (/glm-/.test(id)) {
    score += 320_000;
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

/** Sort model options: provider bucket first, then intelligence desc, then label. */
export function sortModelOptions<T extends ModelOption>(options: T[]): T[] {
  return [...options].sort((a, b) => {
    const pa = parseOptionValue(a.value);
    const pb = parseOptionValue(b.value);
    const providerDiff =
      providerSortKey(pa.providerID) - providerSortKey(pb.providerID);
    if (providerDiff !== 0) return providerDiff;
    // Same bucket but different raw ids (e.g. ollama vs ollama-cloud): keep
    // provider id alphabetical so groups stay contiguous.
    if (pa.providerID !== pb.providerID) {
      return pa.providerID.localeCompare(pb.providerID);
    }
    const scoreDiff =
      modelIntelligenceScore(pb.modelID) - modelIntelligenceScore(pa.modelID);
    if (scoreDiff !== 0) return scoreDiff;
    return a.label.localeCompare(b.label);
  });
}
