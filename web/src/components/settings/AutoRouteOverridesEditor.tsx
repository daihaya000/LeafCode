"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button, cx } from "@/components/ui";
import {
  autoOptimizeModeLabel,
  type AutoOptimizeMode,
  type AutoTier,
  type ModelCostTier,
  type RouteOverrides,
  type TierRouteOverride,
} from "@/lib/auto-model";
import { type IntelligenceVariant } from "@/lib/model-variants";

const TIERS: readonly AutoTier[] = ["light", "standard", "heavy"];

const TIER_LABEL: Record<AutoTier, string> = {
  light: "ライト",
  standard: "標準",
  heavy: "ヘビー",
};

const TIER_DESCRIPTION: Record<AutoTier, string> = {
  light: "短い質問・雑談",
  standard: "一般的なコーディング",
  heavy: "大規模リファクタ・設計",
};

const COST_TIERS: readonly ModelCostTier[] = ["cheap", "mid", "premium"];

const COST_LABEL: Record<ModelCostTier, string> = {
  cheap: "低コスト",
  mid: "中コスト",
  premium: "高コスト",
};

const ALL_VARIANTS: readonly IntelligenceVariant[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
];

const VARIANT_LABEL: Record<IntelligenceVariant, string> = {
  none: "なし",
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
  thinking: "思考",
};

type Mode = AutoOptimizeMode;

/** Resolve the preset cost order for a mode+tier. Mirrors MODE_COST_ORDER. */
function presetCostOrder(mode: Mode, tier: AutoTier): ModelCostTier[] | null {
  if (mode === "cost") {
    return tier === "heavy" ? null : ["cheap", "mid", "premium"];
  }
  if (mode === "balanced") {
    return tier === "heavy"
      ? null
      : tier === "light"
        ? ["cheap", "mid", "premium"]
        : ["mid", "premium", "cheap"];
  }
  // intelligence
  return tier === "heavy"
    ? null
    : tier === "light"
      ? ["mid", "cheap", "premium"]
      : ["premium", "mid", "cheap"];
}

/** Resolve the preset variant order for a mode+tier. Mirrors MODE_VARIANT_ORDER. */
function presetVariantOrder(
  mode: Mode,
  tier: AutoTier,
): IntelligenceVariant[] {
  if (mode === "cost") {
    if (tier === "light") return ["minimal", "none", "low"];
    if (tier === "standard") return ["low", "minimal", "none", "medium"];
    return ["medium", "high", "low"];
  }
  if (mode === "balanced") {
    if (tier === "light") return ["low", "minimal", "none", "medium"];
    if (tier === "standard") return ["medium", "low", "high", "minimal", "none"];
    return ["high", "medium", "max", "low"];
  }
  // intelligence
  if (tier === "light") return ["medium", "low", "high", "minimal", "none"];
  if (tier === "standard") return ["high", "medium", "max", "low"];
  return ["max", "high", "medium"];
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

/**
 * Effective cost order for a tier: override if present, else preset.
 * Returns `null` for "strongest candidate overall".
 */
function effectiveCostOrder(
  mode: Mode,
  tier: AutoTier,
  overrides: RouteOverrides,
): ModelCostTier[] | null {
  const override = overrides[tier]?.costOrder;
  if (override !== undefined) return override === null ? null : [...override];
  return presetCostOrder(mode, tier);
}

function effectiveVariantOrder(
  mode: Mode,
  tier: AutoTier,
  overrides: RouteOverrides,
): IntelligenceVariant[] {
  const override = overrides[tier]?.variantOrder;
  if (override !== undefined) return [...override];
  return presetVariantOrder(mode, tier);
}

/** Whether a tier currently deviates from its preset. */
function tierIsOverridden(
  mode: Mode,
  tier: AutoTier,
  overrides: RouteOverrides,
): boolean {
  const override = overrides[tier];
  if (!override) return false;
  const presetCost = presetCostOrder(mode, tier);
  const presetVariant = presetVariantOrder(mode, tier);
  const costMatches =
    (override.costOrder ?? "unset") ===
    (presetCost === null ? null : (presetCost.slice().join(",") || "unset"))
      ? true
      : JSON.stringify(override.costOrder ?? null) ===
        JSON.stringify(presetCost);
  const variantMatches =
    override.variantOrder !== undefined &&
    JSON.stringify(override.variantOrder) === JSON.stringify(presetVariant);
  // override present but neither field set = empty override, treat as not overridden
  if (override.costOrder === undefined && override.variantOrder === undefined) {
    return false;
  }
  return !(costMatches && variantMatches);
}

/**
 * Build a new RouteOverrides with one tier updated. Tiers equal to the preset
 * are dropped from the map so storage stays minimal.
 */
function withTierOverride(
  mode: Mode,
  tier: AutoTier,
  override: TierRouteOverride | undefined,
  prev: RouteOverrides,
): RouteOverrides {
  const next: RouteOverrides = { ...prev };
  if (!override) {
    delete next[tier];
    return next;
  }
  // Drop the tier if the new value matches the preset.
  const presetCost = presetCostOrder(mode, tier);
  const presetVariant = presetVariantOrder(mode, tier);
  const costMatches =
    (override.costOrder ?? null) === null && presetCost === null
      ? true
      : override.costOrder !== undefined &&
        presetCost !== null &&
        JSON.stringify(override.costOrder) === JSON.stringify(presetCost);
  const variantMatches =
    override.variantOrder !== undefined &&
    JSON.stringify(override.variantOrder) === JSON.stringify(presetVariant);
  if (costMatches && variantMatches) {
    delete next[tier];
    return next;
  }
  next[tier] = override;
  return next;
}

function CostOrderEditor({
  mode,
  tier,
  overrides,
  onChange,
}: {
  mode: Mode;
  tier: AutoTier;
  overrides: RouteOverrides;
  onChange: (override: TierRouteOverride | undefined) => void;
}) {
  const effective = effectiveCostOrder(mode, tier, overrides);
  const isStrongest = effective === null;
  const override = overrides[tier];
  // The editor tracks explicit toggle state. When not overridden, it uses the
  // preset; when the user touches anything, we switch to an explicit list.
  const [explicit, setExplicit] = useState<boolean>(
    () => override?.costOrder !== undefined,
  );
  // Keep `explicit` in sync when the override is cleared externally.
  useEffect(() => {
    setExplicit(override?.costOrder !== undefined);
  }, [override?.costOrder]);

  const list: ModelCostTier[] = isStrongest ? [] : effective ?? [];

  const handleToggleStrongest = () => {
    if (isStrongest) {
      // Switch to the preset list (explicit).
      const preset = presetCostOrder(mode, tier) ?? COST_TIERS.slice();
      setExplicit(true);
      onChange({
        ...override,
        costOrder: preset,
      });
    } else {
      // Switch to "strongest candidate".
      setExplicit(false);
      onChange({
        ...override,
        costOrder: null,
      });
    }
  };

  const handleToggle = (cost: ModelCostTier) => {
    if (!explicit) {
      // First touch seeds from the current effective list.
      const seed = effective ?? [];
      setExplicit(true);
      const next = seed.includes(cost)
        ? seed.filter((c) => c !== cost)
        : [...seed, cost];
      if (next.length === 0) return; // never empty
      onChange({ ...override, costOrder: next });
      return;
    }
    const next = list.includes(cost)
      ? list.filter((c) => c !== cost)
      : [...list, cost];
    if (next.length === 0) return; // never empty
    onChange({ ...override, costOrder: next });
  };

  const handleMove = (index: number, dir: -1 | 1) => {
    if (!explicit) return;
    const next = moveItem(list, index, index + dir);
    onChange({ ...override, costOrder: next });
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={isStrongest}
          onChange={handleToggleStrongest}
          className="h-3.5 w-3.5 accent-primary"
        />
        <span>最強候補を優先（コスト帯で絞らない）</span>
      </label>
      {!isStrongest && (
        <div className="space-y-1">
          {COST_TIERS.map((cost) => {
            const checked = list.includes(cost);
            const index = list.indexOf(cost);
            return (
              <div
                key={cost}
                className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggle(cost)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="flex-1 text-xs text-muted">
                  {COST_LABEL[cost]}
                </span>
                {checked && explicit && (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`${COST_LABEL[cost]} を上へ`}
                      disabled={index <= 0}
                      onClick={() => handleMove(index, -1)}
                      className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3 rotate-180" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${COST_LABEL[cost]} を下へ`}
                      disabled={index >= list.length - 1}
                      onClick={() => handleMove(index, 1)}
                      className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!explicit && (
            <p className="text-[10px] text-faint">
              チェックを変えると個別設定を上書きします
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function VariantOrderEditor({
  mode,
  tier,
  overrides,
  onChange,
}: {
  mode: Mode;
  tier: AutoTier;
  overrides: RouteOverrides;
  onChange: (override: TierRouteOverride | undefined) => void;
}) {
  const override = overrides[tier];
  const effective = effectiveVariantOrder(mode, tier, overrides);
  const [explicit, setExplicit] = useState<boolean>(
    () => override?.variantOrder !== undefined,
  );
  useEffect(() => {
    setExplicit(override?.variantOrder !== undefined);
  }, [override?.variantOrder]);

  const list: IntelligenceVariant[] = explicit
    ? [...(override?.variantOrder ?? [])]
    : effective;

  const handleToggle = (variant: IntelligenceVariant) => {
    if (!explicit) {
      const seed = effective.slice();
      setExplicit(true);
      const next = seed.includes(variant)
        ? seed.filter((v) => v !== variant)
        : [...seed, variant];
      if (next.length === 0) return;
      onChange({ ...override, variantOrder: next });
      return;
    }
    const next = list.includes(variant)
      ? list.filter((v) => v !== variant)
      : [...list, variant];
    if (next.length === 0) return;
    onChange({ ...override, variantOrder: next });
  };

  const handleMove = (index: number, dir: -1 | 1) => {
    if (!explicit) return;
    const next = moveItem(list, index, index + dir);
    onChange({ ...override, variantOrder: next });
  };

  return (
    <div className="space-y-1">
      {ALL_VARIANTS.map((variant) => {
        const checked = list.includes(variant);
        const index = list.indexOf(variant);
        return (
          <div
            key={variant}
            className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => handleToggle(variant)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="flex-1 text-xs text-muted">
              {VARIANT_LABEL[variant]}
            </span>
            {checked && explicit && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`${VARIANT_LABEL[variant]} を上へ`}
                  disabled={index <= 0}
                  onClick={() => handleMove(index, -1)}
                  className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3 rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={`${VARIANT_LABEL[variant]} を下へ`}
                  disabled={index >= list.length - 1}
                  onClick={() => handleMove(index, 1)}
                  className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!explicit && (
        <p className="text-[10px] text-faint">
          チェックを変えると個別設定を上書きします
        </p>
      )}
    </div>
  );
}

/**
 * Editor for per-tier Auto routing overrides. Each tier (light/standard/heavy)
 * can override the cost band order and the reasoning-effort order from the
 * selected optimize mode preset. Unchanged tiers fall back to the preset.
 */
export function AutoRouteOverridesEditor({
  mode,
  overrides,
  onChange,
}: {
  mode: AutoOptimizeMode;
  overrides: RouteOverrides;
  onChange: (next: RouteOverrides) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleTierChange = useCallback(
    (tier: AutoTier, override: TierRouteOverride | undefined) => {
      onChange(withTierOverride(mode, tier, override, overrides));
    },
    [mode, overrides, onChange],
  );

  const handleResetTier = (tier: AutoTier) => {
    const next = { ...overrides };
    delete next[tier];
    onChange(next);
  };

  const handleResetAll = () => {
    onChange({});
  };

  const hasAnyOverride = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <ChevronDown
            className={cx(
              "h-3.5 w-3.5 transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          tier別ルーティング設定
        </button>
        {hasAnyOverride && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="全tierの上書きをリセット"
            onClick={handleResetAll}
          >
            <RotateCcw className="h-3 w-3" />
            リセット
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-4 rounded-lg border border-border bg-surface-2 px-3 py-3">
          <p className="text-xs text-faint">
            各 tier について、選択中の最適化モード（{autoOptimizeModeLabel(mode)}）の初期値から個別に上書きできます。未編集の tier は初期値のまま動きます。
          </p>
          {TIERS.map((tier) => {
            const overridden = tierIsOverridden(mode, tier, overrides);
            return (
              <div
                key={tier}
                className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted">
                      {TIER_LABEL[tier]}
                      <span className="ml-1.5 text-faint">
                        {TIER_DESCRIPTION[tier]}
                      </span>
                    </p>
                  </div>
                  {overridden && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${TIER_LABEL[tier]}の上書きをリセット`}
                      onClick={() => handleResetTier(tier)}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    コスト帯の優先順
                  </p>
                  <CostOrderEditor
                    mode={mode}
                    tier={tier}
                    overrides={overrides}
                    onChange={(override) => handleTierChange(tier, override)}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    推論強度の優先順
                  </p>
                  <VariantOrderEditor
                    mode={mode}
                    tier={tier}
                    overrides={overrides}
                    onChange={(override) => handleTierChange(tier, override)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}