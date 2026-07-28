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

import { modelIntelligenceScore } from "./model-options";
import {
  getIntelligenceVariants,
  type IntelligenceVariant,
} from "./model-variants";

/** ModelSelect option value for the Auto mode. Contains no `::`. */
export const AUTO_MODEL_VALUE = "auto";

export type AutoTier = "light" | "standard" | "heavy";

export type AutoDecision = {
  providerID: string;
  modelID: string;
  variant: IntelligenceVariant | "";
  tier: AutoTier;
  /** Display string (Japanese, machine-generated from templates). */
  reason: string;
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

function countCodeFences(text: string): number {
  let count = 0;
  let index = text.indexOf(CODE_FENCE);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(CODE_FENCE, index + CODE_FENCE.length);
  }
  return count;
}

/**
 * Classify a prompt into a cost tier. Deterministic, regex based.
 * Priority: heavy → light → standard (a single heavy hit wins outright).
 *
 * `opts.hasImages` never changes the tier; it only narrows the candidate set
 * in {@link chooseAutoModel}, so a short question with an image stays `light`.
 */
export function classifyPrompt(
  prompt: string,
  opts: { hasImages: boolean },
): AutoTier {
  void opts;
  const p = prompt.trim();
  const fences = countCodeFences(p);

  // heavy: any single condition is enough.
  if (p.length > HEAVY_LENGTH) return "heavy";
  if (fences >= 4) return "heavy";
  if (HEAVY_KEYWORD_RE.test(p)) return "heavy";

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

export type ModelCostTier = "cheap" | "mid" | "premium";

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

/** Cost band preference per tier: first entry is the primary choice. */
const TIER_COST_ORDER: Record<AutoTier, ModelCostTier[] | null> = {
  light: ["cheap", "mid", "premium"],
  standard: ["mid", "cheap", "premium"],
  // heavy always takes the strongest available model, no cost banding.
  heavy: null,
};

/** Variant (reasoning effort) preference per tier: first match wins. */
const TIER_VARIANT_ORDER: Record<AutoTier, IntelligenceVariant[]> = {
  light: ["minimal", "none", "low"],
  standard: ["low", "minimal", "none", "medium"],
  heavy: ["medium", "high", "low"],
};

const ESCALATION_VARIANT_ORDER: IntelligenceVariant[] = [
  "high",
  "max",
  "medium",
];

const REASON_BY_TIER: Record<AutoTier, string> = {
  light: "短い質問タスクのため低コストモデルを選択しました",
  standard: "標準的なコーディングタスクのため中コストモデルを選択しました",
  heavy: "大規模・高難度タスクのため高性能モデルを選択しました",
};

const REASON_IMAGES_SUFFIX = "（画像対応モデルに限定）";
const REASON_FALLBACK_SUFFIX = "（該当コスト帯に候補がなく上位帯へフォールバック）";

function supportsImages(model: AutoCandidateModel): boolean {
  return (
    model.capabilities?.input?.image === true ||
    model.capabilities?.attachment === true
  );
}

/** Highest `modelIntelligenceScore`; ties broken by `providerID::modelID`. */
function pickBest(candidates: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of candidates) {
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
  order: IntelligenceVariant[],
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
 * Resolve a concrete `{ providerID, modelID, variant }` for the given tier
 * from the connected + enabled model set. Returns `null` when no candidate
 * survives filtering (the caller answers 400).
 */
export function chooseAutoModel(input: {
  /** `/provider` response `all`. */
  providers: AutoCandidateProvider[];
  /** `/provider` response `connected`. Empty = no restriction. */
  connected: string[];
  /** `provider-model-state` disabled map (`providerID` or `providerID::modelID`). */
  disabled: Record<string, true>;
  tier: AutoTier;
  hasImages: boolean;
}): AutoDecision | null {
  const { providers, connected, disabled, tier, hasImages } = input;
  const connectedSet = connected.length > 0 ? new Set(connected) : null;

  // Candidate construction mirrors `listProviderModels`.
  const candidates: Candidate[] = [];
  for (const provider of providers) {
    const providerID = provider.id;
    if (!providerID) continue;
    if (connectedSet && !connectedSet.has(providerID)) continue;
    if (disabled[providerID]) continue;
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      if (!modelID || !model) continue;
      if (disabled[`${providerID}::${modelID}`]) continue;
      if (hasImages && !supportsImages(model)) continue;
      candidates.push({
        providerID,
        modelID,
        key: `${providerID}::${modelID}`,
        cost: modelCostTier(modelID),
        score: modelIntelligenceScore(modelID),
        model,
      });
    }
  }
  if (candidates.length === 0) return null;

  const costOrder = TIER_COST_ORDER[tier];
  let chosen: Candidate | undefined;
  let fellBack = false;
  if (costOrder === null) {
    chosen = pickBest(candidates);
  } else {
    for (const [index, cost] of costOrder.entries()) {
      const best = pickBest(candidates.filter((c) => c.cost === cost));
      if (best) {
        chosen = best;
        fellBack = index > 0;
        break;
      }
    }
    // Every cost band is covered by `costOrder`, so a non-empty candidate
    // list always resolves; keep a defensive fallback anyway.
    if (!chosen) chosen = pickBest(candidates);
  }
  if (!chosen) return null;

  const variant = pickVariant(chosen.model, TIER_VARIANT_ORDER[tier]);

  let reason = REASON_BY_TIER[tier];
  if (hasImages) reason += REASON_IMAGES_SUFFIX;
  if (fellBack) reason += REASON_FALLBACK_SUFFIX;

  const decision: AutoDecision = {
    providerID: chosen.providerID,
    modelID: chosen.modelID,
    variant,
    tier,
    reason,
  };

  // Escalation target for the one-shot automatic retry: the strongest
  // candidate at the highest available effort. Omitted when it is identical
  // to the chosen model (retrying would change nothing).
  const strongest = pickBest(candidates);
  if (strongest) {
    const escalationVariant = pickVariant(
      strongest.model,
      ESCALATION_VARIANT_ORDER,
    );
    const identical =
      strongest.providerID === decision.providerID &&
      strongest.modelID === decision.modelID &&
      escalationVariant === decision.variant;
    if (!identical) {
      decision.escalation = {
        providerID: strongest.providerID,
        modelID: strongest.modelID,
        variant: escalationVariant,
      };
    }
  }

  return decision;
}
