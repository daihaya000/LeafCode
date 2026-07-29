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
  label: "Auto（コスト最適）",
  group: "Auto",
};

export type AutoTier = "light" | "standard" | "heavy";

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

export type AutoDecision = {
  providerID: string;
  modelID: string;
  variant: IntelligenceVariant | "";
  tier: AutoTier;
  /** Optimize mode that produced this decision. */
  mode: AutoOptimizeMode;
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

const TIER_LADDER: readonly AutoTier[] = ["light", "standard", "heavy"];

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
  /** "Optimize For" policy; see {@link MODE_COST_ORDER}. */
  mode: AutoOptimizeMode;
  hasImages: boolean;
}): AutoDecision | null {
  const { providers, connected, disabled, tier, mode, hasImages } = input;
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

  const costOrder = MODE_COST_ORDER[mode][tier];
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

  const variant = pickVariant(chosen.model, MODE_VARIANT_ORDER[mode][tier]);

  let reason = `${TIER_LABEL[tier]}のため${autoOptimizeModeLabel(mode)}で選択しました`;
  if (hasImages) reason += REASON_IMAGES_SUFFIX;
  if (fellBack) reason += REASON_FALLBACK_SUFFIX;

  const decision: AutoDecision = {
    providerID: chosen.providerID,
    modelID: chosen.modelID,
    variant,
    tier,
    mode,
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
