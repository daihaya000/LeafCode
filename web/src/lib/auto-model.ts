/**
 * Auto model selection (cost-optimized, coding-focused).
 *
 * Pure functions only — importable from both the server (BFF route) and the
 * client. No `window` / `node:fs` dependency.
 *
 * The BFF classifies the prompt with deterministic rules (no extra LLM call,
 * zero additional token cost), then picks the cheapest model that still fits
 * the task from the connected + enabled model set.
 */

import { modelIntelligenceScore, type ModelOption } from "./model-options";
import {
  getIntelligenceVariants,
  isIntelligenceVariant,
  type IntelligenceVariant,
} from "./model-variants";

/** ModelSelect option value for the Auto mode. Contains no `::`. */
export const AUTO_MODEL_VALUE = "auto";

/**
 * Shared ModelSelect option for the Auto mode (HomeView / TaskView). The
 * resolver — the BFF for task creation, the client for follow-ups — picks the
 * concrete `{ providerID, modelID, variant }`, so this option carries no
 * provider of its own. Callers must prepend it *after* filter/sort:
 * `providerSortKey("auto")` is the unknown-provider tail value, so sorting
 * would sink it to the bottom.
 */
export const AUTO_MODEL_OPTION: ModelOption = {
  value: AUTO_MODEL_VALUE,
  label: "Auto",
  group: "Auto",
};

export type AutoTier = "light" | "standard" | "heavy";

/** Cost band of a model, derived from its id via name heuristics. */
export type ModelCostTier = "cheap" | "mid" | "premium";

/** Ordered tiers, lowest effort first. */
const TIER_LADDER: readonly AutoTier[] = ["light", "standard", "heavy"];

/**
 * "Optimize For" mode, mirroring Cursor Router.
 *
 * - `cost`: cheapest model that still fits the task (the original behaviour).
 * - `balanced`: trades some spend for intelligence and headroom.
 * - `intelligence`: routes harder tasks to the most capable models, while
 *   still keeping trivial prompts off the frontier tier.
 */
export type AutoOptimizeMode = "cost" | "balanced" | "intelligence";

export const AUTO_OPTIMIZE_MODES: readonly AutoOptimizeMode[] = [
  "cost",
  "balanced",
  "intelligence",
];

export const DEFAULT_AUTO_OPTIMIZE_MODE: AutoOptimizeMode = "cost";

export function isAutoOptimizeMode(value: unknown): value is AutoOptimizeMode {
  return (
    typeof value === "string" &&
    (AUTO_OPTIMIZE_MODES as readonly string[]).includes(value)
  );
}

const AUTO_OPTIMIZE_MODE_LABEL: Record<AutoOptimizeMode, string> = {
  cost: "コスト優先",
  balanced: "バランス",
  intelligence: "知能優先",
};

/** Japanese display name for an optimize mode. */
export function autoOptimizeModeLabel(mode: AutoOptimizeMode): string {
  return AUTO_OPTIMIZE_MODE_LABEL[mode];
}

/**
 * モード × tier のプリセット候補列。差分保存と UI 表示の唯一のソース。
 * 戻り値は freeze して返す。
 */
export function presetTierRoute(
  mode: AutoOptimizeMode,
  tier: AutoTier,
): AutoTierRoute {
  const costOrder = MODE_COST_ORDER[mode][tier];
  const variantOrder = MODE_VARIANT_ORDER[mode][tier];
  const candidates: AutoRouteCandidate[] =
    costOrder === null
      ? [{ kind: "strongest" }]
      : costOrder.map((cost) => ({ kind: "cost", cost }));
  return Object.freeze({
    candidates: Object.freeze(candidates),
    variantFallbackOrder: Object.freeze(variantOrder),
  });
}

/**
 * Per-tier routing override. A missing field falls back to the preset
 * (`MODE_COST_ORDER` / `MODE_VARIANT_ORDER`) for the selected optimize mode.
 * Both arrays are deduped to their first occurrence; unknown entries are
 * rejected by {@link normalizeRouteOverride}.
 */
export type TierRouteOverride = {
  /** Cost band preference, first = primary. `null` = strongest candidate. */
  costOrder?: readonly ModelCostTier[] | null;
  /** Reasoning effort preference, first = primary. */
  variantOrder?: readonly IntelligenceVariant[];
};

/** Full override map. Missing tiers fall back to the preset. */
export type RouteOverrides = Partial<Record<AutoTier, TierRouteOverride>>;

/**
 * Empty override (all presets). The canonical "no customization" value,
 * returned by reference from multiple call sites — frozen so a caller that
 * mutates its result in place (e.g. `overrides[tier] = {...}`) throws
 * instead of silently corrupting every other caller's "no customization"
 * default.
 */
export const EMPTY_ROUTE_OVERRIDES: RouteOverrides = Object.freeze({});

/** ------------------------------------------------------------------ */
/**  v2 型（本仕様: auto-route-candidates.md）                         */
/** ------------------------------------------------------------------ */

export const AUTO_ROUTE_CONFIG_VERSION = 2 as const;

/** 1 件のルーティング指定。 */
export type AutoRouteCandidate =
  | {
      kind: "model";
      providerID: string;
      modelID: string;
      variant?: IntelligenceVariant | "";
    }
  | { kind: "cost"; cost: ModelCostTier; variant?: IntelligenceVariant | "" }
  | { kind: "strongest"; variant?: IntelligenceVariant | "" };

/** 全候補が使えなかった時の挙動。既定 "preset"。 */
export type AutoTierFallback = "preset" | "strongest" | "error";

export type AutoTierRoute = {
  /** 優先順。空配列 = プリセットの候補列を使う */
  readonly candidates: readonly AutoRouteCandidate[];
  /** 候補の variant が使えない時の代替順。省略 = モードプリセット */
  readonly variantFallbackOrder?: readonly IntelligenceVariant[];
  /** 省略 = "preset" */
  fallback?: AutoTierFallback;
};

export type AutoModeRoute = Partial<Record<AutoTier, AutoTierRoute>>;

export type AutoRouteConfig = {
  version: typeof AUTO_ROUTE_CONFIG_VERSION;
  modes: Partial<Record<AutoOptimizeMode, AutoModeRoute>>;
};

/** 「未設定」の正典値。 */
export const EMPTY_AUTO_ROUTE_CONFIG: AutoRouteConfig = Object.freeze({
  version: AUTO_ROUTE_CONFIG_VERSION,
  modes: Object.freeze({}),
});

/** 1 セルあたりの候補数上限。 */
export const MAX_AUTO_ROUTE_CANDIDATES = 8;

export function isAutoTierFallback(value: unknown): value is AutoTierFallback {
  return value === "preset" || value === "strongest" || value === "error";
}

function isModelCostTier(value: unknown): value is ModelCostTier {
  return value === "cheap" || value === "mid" || value === "premium";
}

/**
 * Dedupe an array to first-occurrence order, keeping only entries `guard`
 * accepts. Priority-order fields (which entry wins ties) must preserve the
 * caller's array order, not a canonical one — that IS the setting.
 */
function dedupeInOrder<T extends string>(
  entries: readonly unknown[],
  guard: (value: unknown) => value is T,
): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const entry of entries) {
    if (guard(entry) && !seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}

/**
 * Normalize a single tier override: drop unknown / duplicate entries and
 * preserve only the first occurrence, in the caller's priority order.
 * Returns `undefined` when the input carries no usable field, so callers can
 * omit the tier entirely.
 */
function normalizeTierOverride(
  raw: unknown,
): TierRouteOverride | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  let costOrder: readonly ModelCostTier[] | null | undefined;
  if (obj.costOrder === null) {
    costOrder = null;
  } else if (Array.isArray(obj.costOrder)) {
    const ordered = dedupeInOrder(obj.costOrder, isModelCostTier);
    if (ordered.length > 0) costOrder = ordered;
  }
  let variantOrder: readonly IntelligenceVariant[] | undefined;
  if (Array.isArray(obj.variantOrder)) {
    const ordered = dedupeInOrder(obj.variantOrder, isIntelligenceVariant);
    if (ordered.length > 0) variantOrder = ordered;
  }
  if (costOrder === undefined && variantOrder === undefined) return undefined;
  const result: TierRouteOverride = {};
  if (costOrder !== undefined) result.costOrder = costOrder;
  if (variantOrder !== undefined) result.variantOrder = variantOrder;
  return result;
}

/**
 * Validate and normalize a raw (JSON-parsed) override map. Unknown tiers and
 * unknown entries are silently dropped, so a corrupted payload never blocks
 * routing — it just falls back to the preset.
 */
export function normalizeRouteOverrides(raw: unknown): RouteOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const result: RouteOverrides = {};
  for (const tier of TIER_LADDER) {
    const override = normalizeTierOverride(obj[tier]);
    if (override) result[tier] = override;
  }
  return result;
}

/** Whether the override map is effectively empty. */
export function isRouteOverridesEmpty(overrides: RouteOverrides): boolean {
  return Object.keys(overrides).length === 0;
}

export type AutoDecision = {
  providerID: string;
  modelID: string;
  variant: IntelligenceVariant | "";
  tier: AutoTier;
  /** Optimize mode that produced this decision. */
  mode: AutoOptimizeMode;
  /** Display string (Japanese, machine-generated from templates). */
  reason: string;
  /** 採用した候補の 0 始まりインデックス。プリセット由来は undefined */
  candidateIndex?: number;
  /** プリセットへフォールバックして解決したか */
  usedPreset?: boolean;
  escalation?: {
    providerID: string;
    modelID: string;
    variant: IntelligenceVariant | "";
  };
};

/** Minimal structure needed from the `/provider` response (structural typing). */
export type AutoCandidateProvider = {
  id: string;
  models: Record<
    string,
    {
      name?: string;
      variants?: Record<string, { disabled?: boolean } | undefined>;
      capabilities?: {
        attachment?: boolean;
        input?: { image?: boolean };
      };
    }
  >;
};

/**
 * Optional provider availability data supplied by CodexBar. Keys are
 * OpenCode provider IDs, so unknown CodexBar providers never affect routing.
 * Missing entries deliberately retain the normal model policy.
 */
export type AutoProviderUsage = Record<
  string,
  { usedPercent: number | null; limited: boolean }
>;

/** Minimum known utilization gap that is worth rerouting an Auto request. */
export const AUTO_USAGE_REROUTE_GAP = 20;

type AutoCandidateModel = AutoCandidateProvider["models"][string];

const HEAVY_KEYWORD_RE =
  /リファクタ|再設計|作り直|移行|マイグレ|アーキテクチャ|全面|全体的|複数ファイル|横断|パフォーマンス改善|最適化|デッドロック|競合状態|refactor|redesign|migrat|architect|multi-?file|cross-?cutting|deadlock|race condition|optimi[sz]e/i;

const QUESTION_RE =
  /なぜ|何が|どこ|どうやって|どういう|とは|教えて|説明|意味|why|what|where|how|explain|mean/i;

const WORK_RE =
  /実装|修正|追加|作成|変更|書いて|直して|消して|削除|テスト書|fix|implement|add|create|write|update|delete|remove/i;

const CODE_FENCE = "```";
const HEAVY_LENGTH = 1500;
const LIGHT_LENGTH = 200;

/**
 * Source-ish file references. Distinct hits above
 * {@link SIGNAL_FILE_PATH_THRESHOLD} mean the prompt spans several files,
 * which is the cheapest reliable proxy for "multi-file change".
 */
const FILE_PATH_RE =
  /[\w./\\-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|cpp|c|h|md|json|jsonc|ya?ml|toml|css|scss|html|sql|sh|bat|ps1)\b/gi;

/** Ordered numbered-list items (`1.` / `1)` at line start). */
const NUMBERED_ITEM_RE = /^[ \t]*\d+[.)][ \t]+\S/gm;

/** Distinct file references that push a prompt to `heavy`. */
export const SIGNAL_FILE_PATH_THRESHOLD = 3;
/** Numbered list items that push a prompt to `heavy`. */
export const SIGNAL_NUMBERED_LIST_THRESHOLD = 4;
/** Attachments on a single send that bump the tier one step. */
export const SIGNAL_ATTACHMENT_THRESHOLD = 3;
/** Session messages that bump the tier one step. */
export const SIGNAL_HISTORY_THRESHOLD = 20;

/**
 * Context available to the classifier beyond the prompt text itself. All
 * fields are free to compute (no extra tokens, no extra requests).
 */
export type AutoSignals = {
  /**
   * Whether images are attached. Never changes the tier; it only narrows the
   * candidate set in {@link chooseAutoModel}.
   */
  hasImages: boolean;
  /** Attachments on this send. Defaults to 0. */
  attachmentCount?: number;
  /** Messages already in the session (follow-up depth). Defaults to 0. */
  historyMessageCount?: number;
  /** The previous turn failed. Defaults to false. */
  recentFailure?: boolean;
};

function countCodeFences(text: string): number {
  let count = 0;
  let index = text.indexOf(CODE_FENCE);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(CODE_FENCE, index + CODE_FENCE.length);
  }
  return count;
}

function countDistinctFilePaths(text: string): number {
  const seen = new Set<string>();
  for (const match of text.matchAll(FILE_PATH_RE)) {
    seen.add(match[0].toLowerCase());
  }
  return seen.size;
}

function countMatches(text: string, re: RegExp): number {
  let count = 0;
  for (const match of text.matchAll(re)) {
    void match;
    count += 1;
  }
  return count;
}

/** One step up the ladder; `heavy` stays `heavy`. */
function bumpTier(tier: AutoTier): AutoTier {
  const index = TIER_LADDER.indexOf(tier);
  return TIER_LADDER[Math.min(index + 1, TIER_LADDER.length - 1)] ?? tier;
}

/** Text-only classification. Priority: heavy → light → standard. */
function classifyText(prompt: string): AutoTier {
  const p = prompt.trim();
  const fences = countCodeFences(p);

  // heavy: any single condition is enough.
  if (p.length > HEAVY_LENGTH) return "heavy";
  if (fences >= 4) return "heavy";
  if (HEAVY_KEYWORD_RE.test(p)) return "heavy";
  if (countDistinctFilePaths(p) >= SIGNAL_FILE_PATH_THRESHOLD) return "heavy";
  if (countMatches(p, NUMBERED_ITEM_RE) >= SIGNAL_NUMBERED_LIST_THRESHOLD) {
    return "heavy";
  }

  // light: every condition must hold.
  if (
    p.length < LIGHT_LENGTH &&
    fences === 0 &&
    QUESTION_RE.test(p) &&
    !WORK_RE.test(p)
  ) {
    return "light";
  }

  return "standard";
}

/**
 * Classify a prompt into a cost tier. Deterministic, regex based.
 *
 * The text decides the base tier; context signals (a failed previous turn,
 * many attachments, a long session) then raise it by **at most one step** so
 * that several weak signals can never jump `light` straight to `heavy`.
 */
export function classifyPrompt(prompt: string, signals: AutoSignals): AutoTier {
  const base = classifyText(prompt);
  const escalate =
    signals.recentFailure === true ||
    (signals.attachmentCount ?? 0) >= SIGNAL_ATTACHMENT_THRESHOLD ||
    (signals.historyMessageCount ?? 0) >= SIGNAL_HISTORY_THRESHOLD;
  return escalate ? bumpTier(base) : base;
}

const CHEAP_RE = /flash|mini|nano|lite|haiku|\bfast\b/;
const PREMIUM_RE = /fable|opus|ultra|\bsol\b/;

/**
 * Cost band of a model, derived from its id via name heuristics.
 *
 * All name-based cost judgement lives here on purpose: a new model name that
 * is misclassified only needs fixing in this one function.
 */
export function modelCostTier(modelID: string): ModelCostTier {
  const id = modelID.toLowerCase().replaceAll("_", "-");
  if (CHEAP_RE.test(id)) return "cheap";
  if (PREMIUM_RE.test(id)) return "premium";
  return "mid";
}

type Candidate = {
  providerID: string;
  modelID: string;
  key: string;
  cost: ModelCostTier;
  score: number;
  model: AutoCandidateModel;
};

/**
 * Cost band preference per optimize mode and tier: first entry is the primary
 * choice, `null` means "strongest candidate overall, no cost banding".
 *
 * The whole mode policy lives in this table and {@link MODE_VARIANT_ORDER} so
 * that tuning routing never touches the selection algorithm. The `cost`
 * standard row intentionally prefers `cheap` first to make cost-priority mode
 * aggressively economical even for small coding tasks.
 */
const MODE_COST_ORDER: Record<
  AutoOptimizeMode,
  Record<AutoTier, ModelCostTier[] | null>
> = {
  cost: {
    light: ["cheap", "mid", "premium"],
    standard: ["cheap", "mid", "premium"],
    heavy: null,
  },
  balanced: {
    light: ["cheap", "mid", "premium"],
    standard: ["mid", "premium", "cheap"],
    heavy: null,
  },
  intelligence: {
    light: ["mid", "cheap", "premium"],
    standard: ["premium", "mid", "cheap"],
    heavy: null,
  },
};

/** Variant (reasoning effort) preference per optimize mode and tier. */
const MODE_VARIANT_ORDER: Record<
  AutoOptimizeMode,
  Record<AutoTier, IntelligenceVariant[]>
> = {
  cost: {
    light: ["minimal", "none", "low"],
    standard: ["low", "minimal", "none", "medium"],
    heavy: ["medium", "high", "low"],
  },
  balanced: {
    light: ["low", "minimal", "none", "medium"],
    standard: ["medium", "low", "high", "minimal", "none"],
    heavy: ["high", "medium", "max", "low"],
  },
  intelligence: {
    light: ["medium", "low", "high", "minimal", "none"],
    standard: ["high", "medium", "max", "low"],
    heavy: ["max", "high", "medium"],
  },
};

const ESCALATION_VARIANT_ORDER: IntelligenceVariant[] = [
  "high",
  "max",
  "medium",
];

const TIER_LABEL: Record<AutoTier, string> = {
  light: "短い質問タスク",
  standard: "標準的なコーディングタスク",
  heavy: "大規模・高難度タスク",
};

const REASON_IMAGES_SUFFIX = "（画像対応モデルに限定）";
const REASON_FALLBACK_SUFFIX = "（該当コスト帯に候補がなく別コスト帯へフォールバック）";

function supportsImages(model: AutoCandidateModel): boolean {
  return (
    model.capabilities?.input?.image === true ||
    model.capabilities?.attachment === true
  );
}

/** Highest `modelIntelligenceScore`; ties broken by `providerID::modelID`. */
function pickBest(
  candidates: Candidate[],
  usage?: AutoProviderUsage,
): Candidate | undefined {
  const eligible = usage
    ? candidates.filter((candidate) => !usage[candidate.providerID]?.limited)
    : candidates;
  if (eligible.length === 0) return undefined;

  let normalBest: Candidate | undefined;
  for (const candidate of eligible) {
    if (
      !normalBest ||
      candidate.score > normalBest.score ||
      (candidate.score === normalBest.score && candidate.key < normalBest.key)
    ) {
      normalBest = candidate;
    }
  }
  if (!normalBest || !usage) return normalBest;

  const normalUsage = usage[normalBest.providerID]?.usedPercent ?? null;
  // An unknown value must retain the normal policy. Otherwise unrelated
  // known-provider gaps could silently remove the strongest candidate.
  if (normalUsage === null) return normalBest;

  const knownUsage = eligible.filter(
    (candidate) => usage[candidate.providerID]?.usedPercent != null,
  );
  const lowestUsage = knownUsage.reduce<number | null>((lowest, candidate) => {
    const value = usage[candidate.providerID]?.usedPercent ?? null;
    return value === null || (lowest !== null && value >= lowest)
      ? lowest
      : value;
  }, null);
  const usagePreferred =
    lowestUsage !== null &&
    normalUsage - lowestUsage >= AUTO_USAGE_REROUTE_GAP
      ? knownUsage.filter(
          (candidate) => usage[candidate.providerID]?.usedPercent === lowestUsage,
        )
      : eligible;

  let best: Candidate | undefined;
  for (const candidate of usagePreferred) {
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.key < best.key)
    ) {
      best = candidate;
    }
  }
  return best;
}

function pickVariant(
  model: AutoCandidateModel,
  order: readonly IntelligenceVariant[],
): IntelligenceVariant | "" {
  const available = new Set<IntelligenceVariant>(
    getIntelligenceVariants(model),
  );
  for (const variant of order) {
    if (available.has(variant)) return variant;
  }
  return "";
}

/**
 * Resolve a single candidate to a concrete model from the pool, or `null` if
 * it cannot be adopted (spec §3-3). `kind: "model"` checks exact identity and
 * only skips on `usage.limited`; `cost` / `strongest` delegate to `pickBest`,
 * so the usage reroute logic applies there.
 */
function resolveCandidate(
  pool: Candidate[],
  candidate: AutoRouteCandidate,
  usage?: AutoProviderUsage,
): Candidate | undefined {
  if (candidate.kind === "model") {
    const match = pool.find(
      (c) => c.providerID === candidate.providerID && c.modelID === candidate.modelID,
    );
    if (!match) return undefined;
    if (usage && usage[match.providerID]?.limited) return undefined;
    return match;
  }
  if (candidate.kind === "cost") {
    return pickBest(
      pool.filter((c) => c.cost === candidate.cost),
      usage,
    );
  }
  return pickBest(pool, usage);
}

/**
 * Candidate's effort determination (spec §3-4). `""` forces no effort; a named
 * variant is used when the model supports it; otherwise the fallback order is
 * walked. Missing key (`undefined`) means "auto" → fallback order.
 */
function resolveCandidateVariant(
  model: AutoCandidateModel,
  candidate: AutoRouteCandidate,
  fallbackOrder: readonly IntelligenceVariant[],
): IntelligenceVariant | "" {
  if (candidate.variant === "") return "";
  const available = new Set<IntelligenceVariant>(getIntelligenceVariants(model));
  if (
    candidate.variant !== undefined &&
    available.has(candidate.variant)
  ) {
    return candidate.variant;
  }
  return pickVariant(model, fallbackOrder);
}

type ResolvedCandidate = {
  chosen: Candidate;
  index: number;
  variant: IntelligenceVariant | "";
  fellBack: boolean;
  usedPreset: boolean;
};

/**
 * Convert a v1 per-tier override (costOrder / variantOrder) into a v2 route
 * (spec §4-1). `costOrder: X[]` → cost candidates; `null` → strongest; the two
 * axes stay independent because the v1 model resolved them separately.
 */
function legacyRouteToTierRoute(override: TierRouteOverride): AutoTierRoute {
  const candidates: AutoRouteCandidate[] =
    override.costOrder === null
      ? [{ kind: "strongest" }]
      : (override.costOrder ?? []).map((cost) => ({ kind: "cost", cost }));
  return {
    candidates,
    ...(override.variantOrder !== undefined
      ? { variantFallbackOrder: [...override.variantOrder] as readonly IntelligenceVariant[] }
      : {}),
  };
}

/**
 * Build an `AutoDecision` from a resolved candidate (reason templates, the
 * candidateIndex / usedPreset flags, and the escalation, spec §3-6 / §3-7).
 */
function buildDecision(
  pool: Candidate[],
  resolution: ResolvedCandidate,
  tier: AutoTier,
  mode: AutoOptimizeMode,
  hasImages: boolean,
  usage: AutoProviderUsage | undefined,
  candidates: readonly AutoRouteCandidate[],
  fromConfig: boolean,
  fallbackOrder: readonly IntelligenceVariant[],
): AutoDecision {
  const { chosen, index, variant } = resolution;

  let reason: string;
  if (fromConfig && index >= 0) {
    reason = `${TIER_LABEL[tier]}のため候補${index + 1}（${chosen.modelID}${variant ? ` / ${variant}` : ""}）を採用しました`;
    if (index > 0) reason += `（候補1〜${index}は利用不可）`;
  } else {
    reason = `${TIER_LABEL[tier]}のため${autoOptimizeModeLabel(mode)}で選択しました`;
  }
  if (hasImages) reason += REASON_IMAGES_SUFFIX;
  if (!fromConfig && resolution.fellBack) reason += REASON_FALLBACK_SUFFIX;

  const decision: AutoDecision = {
    providerID: chosen.providerID,
    modelID: chosen.modelID,
    variant,
    tier,
    mode,
    reason,
  };
  if (fromConfig && index >= 0) decision.candidateIndex = index;
  if (resolution.usedPreset) decision.usedPreset = true;

  // Escalation (spec §3-7): from the adopted index +1 onward, re-run §3-3
  // and take the first resolvable candidate. If none, fall back to the old
  // logic (different provider preferred, then strongest). Omit when identical.
  const adoptedList =
    fromConfig && index >= 0
      ? candidates.slice(index + 1)
      : [];
  let escalationChosen: Candidate | undefined;
  let escalationVariant: IntelligenceVariant | "" = "";
  if (adoptedList.length > 0) {
    const nextFirst = firstResolvable(pool, adoptedList, fallbackOrder, usage);
    if (nextFirst) {
      const candidate = adoptedList[nextFirst.index];
      escalationChosen = nextFirst.chosen;
      escalationVariant = candidate
        ? resolveCandidateVariant(nextFirst.chosen.model, candidate, fallbackOrder)
        : "";
    }
  }
  if (!escalationChosen) {
    const alternateProviderCandidates = pool.filter(
      (candidate) => candidate.providerID !== chosen.providerID,
    );
    escalationChosen = pickBest(
      alternateProviderCandidates.length > 0
        ? alternateProviderCandidates
        : pool,
      usage,
    );
    escalationVariant = escalationChosen
      ? pickVariant(escalationChosen.model, ESCALATION_VARIANT_ORDER)
      : "";
  }
  if (escalationChosen) {
    const identical =
      escalationChosen.providerID === chosen.providerID &&
      escalationChosen.modelID === chosen.modelID &&
      escalationVariant === variant;
    if (!identical) {
      decision.escalation = {
        providerID: escalationChosen.providerID,
        modelID: escalationChosen.modelID,
        variant: escalationVariant,
      };
    }
  }

  return decision;
}

/** Walk `candidates` in priority order and return the first adoptable one. */
function firstResolvable(
  pool: Candidate[],
  candidates: readonly AutoRouteCandidate[],
  fallbackOrder: readonly IntelligenceVariant[],
  usage?: AutoProviderUsage,
): { chosen: Candidate; index: number } | undefined {
  for (let i = 0; i < candidates.length; i++) {
    const chosen = resolveCandidate(pool, candidates[i], usage);
    if (chosen) return { chosen, index: i };
  }
  return undefined;
}

/**
 * Resolve a concrete `{ providerID, modelID, variant }` for the given tier
 * from the connected + enabled model set. Returns `null` when no candidate
 * survives filtering (the caller answers 400).
 *
 * Resolution is driven by the effective `AutoTierRoute` (spec §3): the config
 * cell for the mode+tier when present (falling back to preset.candidates when
 * its own list is empty), else the mode preset. `overrides` is a transitional
 * legacy (v1) bridge converted into a route; callers are migrated to `config`
 * in a later step.
 */
export function chooseAutoModel(input: {
  /** `/provider` response `all`. */
  providers: AutoCandidateProvider[];
  /**
   * `/provider` response `connected`. An omitted legacy field means no
   * restriction; an explicit empty list means no providers are connected.
   */
  connected?: string[];
  /** `provider-model-state` disabled map (`providerID` or `providerID::modelID`). */
  disabled: Record<string, true>;
  tier: AutoTier;
  /** "Optimize For" policy; see {@link MODE_COST_ORDER}. */
  mode: AutoOptimizeMode;
  hasImages: boolean;
  /** CodexBar utilization, when its addon is enabled and snapshot is usable. */
  usage?: AutoProviderUsage;
  /** v2 routing config; missing cell falls back to the preset. */
  config?: AutoRouteConfig;
  /** v1 per-tier overrides (transitional bridge). */
  overrides?: RouteOverrides;
}): AutoDecision | null {
  const { providers, connected, disabled, tier, mode, hasImages, usage } = input;
  const config = input.config ?? EMPTY_AUTO_ROUTE_CONFIG;
  const overrides = input.overrides ?? EMPTY_ROUTE_OVERRIDES;
  const connectedSet = connected === undefined ? null : new Set(connected);

  // Candidate construction mirrors `listProviderModels`.
  const pool: Candidate[] = [];
  for (const provider of providers) {
    const providerID = provider.id;
    if (!providerID) continue;
    if (connectedSet && !connectedSet.has(providerID)) continue;
    if (disabled[providerID]) continue;
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      if (!modelID || !model) continue;
      if (disabled[`${providerID}::${modelID}`]) continue;
      if (hasImages && !supportsImages(model)) continue;
      pool.push({
        providerID,
        modelID,
        key: `${providerID}::${modelID}`,
        cost: modelCostTier(modelID),
        score: modelIntelligenceScore(modelID),
        model,
      });
    }
  }
  if (pool.length === 0) return null;

  // Effective route (spec §3-1). The v1 override is bridged into a route so
  // existing callers keep working; `config` takes precedence.
  const legacyRoute = overrides[tier];
  const configured = config.modes[mode]?.[tier];
  const preset = presetTierRoute(mode, tier);
  const hasConfigCandidates =
    configured !== undefined && configured.candidates.length > 0;
  const effectiveRoute =
    hasConfigCandidates ? configured
    : legacyRoute ? legacyRouteToTierRoute(legacyRoute)
    : preset;
  const candidates =
    effectiveRoute.candidates.length > 0
      ? effectiveRoute.candidates
      : preset.candidates;
  const fallbackOrder = effectiveRoute.variantFallbackOrder ?? preset.variantFallbackOrder ?? [];

  const first = firstResolvable(pool, candidates, fallbackOrder, usage);

  // Normal resolution path (spec §3-3 / §3-4).
  if (first) {
    const candidate = candidates[first.index];
    const resolution: ResolvedCandidate = {
      chosen: first.chosen,
      index: first.index,
      variant:
        candidate
          ? resolveCandidateVariant(first.chosen.model, candidate, fallbackOrder)
          : "",
      fellBack: first.index > 0,
      usedPreset: false,
    };
    return buildDecision(
      pool, resolution, tier, mode, hasImages, usage,
      candidates, hasConfigCandidates, fallbackOrder,
    );
  }

  // All candidates unusable (spec §3-5).
  const fallback = effectiveRoute.fallback ?? "preset";
  if (fallback === "error") return null;

  let resolution: ResolvedCandidate | undefined;
  if (fallback === "preset") {
    const presetFirst = firstResolvable(pool, preset.candidates, fallbackOrder, usage);
    if (presetFirst) {
      const presetCandidate = preset.candidates[presetFirst.index];
      resolution = {
        chosen: presetFirst.chosen,
        index: presetFirst.index,
        variant:
          presetCandidate
            ? resolveCandidateVariant(presetFirst.chosen.model, presetCandidate, fallbackOrder)
            : "",
        fellBack: true,
        usedPreset: true,
      };
    }
  }
  if (!resolution) {
    const best = pickBest(pool, usage);
    if (!best) return null;
    resolution = {
      chosen: best,
      index: -1,
      variant: pickVariant(best.model, fallbackOrder),
      fellBack: false,
      usedPreset: fallback === "preset",
    };
  }
  return buildDecision(
    pool, resolution, tier, mode, hasImages, usage,
    preset.candidates, false, preset.variantFallbackOrder ?? [],
  );
}
