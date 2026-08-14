"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCcw, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import {
  AUTO_OPTIMIZE_MODES,
  autoOptimizeModeLabel,
  chooseAutoModel,
  isAutoRouteConfigEmpty,
  MAX_AUTO_ROUTE_CANDIDATES,
  normalizeAutoRouteConfig,
  presetTierRoute,
  type AutoModeRoute,
  type AutoOptimizeMode,
  type AutoRouteCandidate,
  type AutoRouteConfig,
  type AutoTier,
  type AutoTierFallback,
  type AutoTierRoute,
  type ModelCostTier,
} from "@/lib/auto-model";
import {
  ALL_INTELLIGENCE_VARIANTS,
  getIntelligenceVariants,
  type IntelligenceVariant,
} from "@/lib/model-variants";

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

const KIND_LABEL: Record<AutoRouteCandidate["kind"], string> = {
  model: "モデル指定",
  cost: "コスト帯",
  strongest: "最強候補",
};

const FALLBACK_LABEL: Record<AutoTierFallback, string> = {
  preset: "プリセットに従う",
  strongest: "最強候補にフォールバック",
  error: "エラーにする",
};

const FALLBACKS: readonly AutoTierFallback[] = ["preset", "strongest", "error"];

/** Candidate list kind for the kind dropdown. */
type CandidateKind = AutoRouteCandidate["kind"];

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

/** Whether the cell is absent, or exactly the preset (stored minimally). */
function cellMatchesPreset(
  mode: AutoOptimizeMode,
  tier: AutoTier,
  cell: AutoTierRoute | undefined,
): boolean {
  if (!cell) return true;
  const preset = presetTierRoute(mode, tier);
  return JSON.stringify(cell) === JSON.stringify(preset);
}

/** Structural subset of the provider list the editor needs. */
export type AutoRouteProviders = readonly {
  id: string;
  name: string;
  enabled: boolean;
  models: readonly {
    id: string;
    name: string;
    enabled: boolean;
    variants?: Record<string, { disabled?: boolean } | undefined>;
  }[];
}[];

export type AutoRouteModelOption = {
  value: string;
  label: string;
  group: string;
};

/** Model dropdown options from the provider list (no Auto entry). */
export function autoRouteModelOptions(
  providers: AutoRouteProviders,
): AutoRouteModelOption[] {
  const options: AutoRouteModelOption[] = [];
  for (const provider of providers) {
    if (!provider.name) continue;
    for (const model of provider.models) {
      options.push({
        value: `${provider.id}::${model.id}`,
        label: `${model.name || model.id}${provider.enabled && model.enabled ? "" : "（未接続）"}`,
        group: provider.name,
      });
    }
  }
  return options;
}

/** Variants declared by the model at `providerID::modelID`, if any. */
function modelVariantsFor(
  providers: AutoRouteProviders,
  providerID: string,
  modelID: string,
): IntelligenceVariant[] {
  const provider = providers.find((p) => p.id === providerID);
  const model = provider?.models.find((m) => m.id === modelID);
  return getIntelligenceVariants(model);
}

/**
 * Effort options for a candidate row. A fixed model narrows the list to its
 * declared variants; cost/strongest rows show everything (the model is not
 * known yet).
 */
function effortOptionsFor(
  candidate: AutoRouteCandidate,
  providers: AutoRouteProviders,
): IntelligenceVariant[] {
  if (candidate.kind === "model") {
    const declared = modelVariantsFor(
      providers,
      candidate.providerID,
      candidate.modelID,
    );
    return declared.length > 0 ? declared : ALL_INTELLIGENCE_VARIANTS;
  }
  return ALL_INTELLIGENCE_VARIANTS;
}

/**
 * Live preview: dry-run chooseAutoModel against the provider list for the
 * current mode+tier and show what Auto would pick.
 */
function ResolutionPreview({
  mode,
  tier,
  config,
  providers,
}: {
  mode: AutoOptimizeMode;
  tier: AutoTier;
  config: AutoRouteConfig;
  providers: AutoRouteProviders;
}) {
  const preview = useMemo(() => {
    const candidateProviders = providers.map((provider) => ({
      id: provider.id,
      models: Object.fromEntries(
        provider.models.map((model) => [model.id, { ...model }]),
      ),
    }));
    const disabled: Record<string, true> = {};
    for (const provider of providers) {
      if (!provider.enabled) disabled[provider.id] = true;
      for (const model of provider.models) {
        if (!model.enabled) disabled[`${provider.id}::${model.id}`] = true;
      }
    }
    return chooseAutoModel({
      providers: candidateProviders,
      connected: providers
        .filter((provider) => provider.enabled)
        .map((provider) => provider.id),
      disabled,
      tier,
      mode,
      hasImages: false,
      config,
    });
  }, [mode, tier, config, providers]);

  if (!preview) {
    return (
      <p className="text-xs text-danger">
        解決できません（候補が全て未接続です）
      </p>
    );
  }
  return (
    <p className="text-xs text-muted">
      現在の解決結果: {preview.modelID}
      {preview.variant
        ? ` / ${VARIANT_LABEL[preview.variant] ?? preview.variant}`
        : ""}
    </p>
  );
}

/**
 * Select value that distinguishes "auto" (no variant key) from "explicit
 * none" (`""`). The raw `""` value cannot represent both.
 */
function effortSelectValue(variant: IntelligenceVariant | "" | undefined): string {
  if (variant === undefined) return "auto";
  if (variant === "") return "none";
  return variant;
}

function CandidateRow({
  index,
  candidate,
  providers,
  modelOptions,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  candidate: AutoRouteCandidate;
  providers: AutoRouteProviders;
  modelOptions: AutoRouteModelOption[];
  onChange: (candidate: AutoRouteCandidate) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const effortOptions = effortOptionsFor(candidate, providers);
  const isFirst = index === 0;

  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
      <span className="w-4 shrink-0 text-right text-[10px] text-faint">
        {index + 1}.
      </span>
      <select
        aria-label={`候補${index + 1}の種別`}
        value={candidate.kind}
        onChange={(event) => {
          const next = event.target.value as CandidateKind;
          if (next === "model") {
            const firstModel = modelOptions[0];
            onChange(
              firstModel
                ? {
                    kind: "model",
                    providerID: firstModel.value.split("::")[0] ?? "",
                    modelID: firstModel.value.split("::")[1] ?? "",
                  }
                : { kind: "cost", cost: "mid" },
            );
          } else if (next === "cost") {
            onChange({ kind: "cost", cost: "mid" });
          } else {
            onChange({ kind: "strongest" });
          }
        }}
        className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        {(["model", "cost", "strongest"] as const).map((value) => (
          <option key={value} value={value}>
            {KIND_LABEL[value]}
          </option>
        ))}
      </select>

      {candidate.kind === "model" && (
        <select
          aria-label={`候補${index + 1}のモデル`}
          value={`${candidate.providerID}::${candidate.modelID}`}
          onChange={(event) => {
            const [providerID, modelID] = event.target.value.split("::");
            onChange({
              ...candidate,
              providerID: providerID ?? "",
              modelID: modelID ?? "",
            });
          }}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-1.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {modelOptions.length === 0 && <option value="">モデルなし</option>}
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {candidate.kind === "cost" && (
        <select
          aria-label={`候補${index + 1}のコスト帯`}
          value={candidate.cost}
          onChange={(event) =>
            onChange({ ...candidate, cost: event.target.value as ModelCostTier })
          }
          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-1.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {COST_TIERS.map((cost) => (
            <option key={cost} value={cost}>
              {COST_LABEL[cost]}
            </option>
          ))}
        </select>
      )}
      {candidate.kind === "strongest" && (
        <span className="flex-1 text-xs text-faint">最強候補を優先</span>
      )}

      <select
        aria-label={`候補${index + 1}のeffort`}
        value={effortSelectValue(candidate.variant)}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "auto") {
            onChange({ ...candidate, variant: undefined });
          } else if (value === "none") {
            onChange({ ...candidate, variant: "" });
          } else {
            onChange({ ...candidate, variant: value as IntelligenceVariant });
          }
        }}
        className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <option value="auto">自動</option>
        <option value="none">指定なし</option>
        {effortOptions.map((variant) => (
          <option key={variant} value={variant}>
            {VARIANT_LABEL[variant] ?? variant}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`候補${index + 1}を上へ`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`候補${index + 1}を下へ`}
          onClick={() => onMove(1)}
          className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`候補${index + 1}を削除`}
          onClick={onRemove}
          className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-danger"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function TierEditor({
  mode,
  tier,
  config,
  modelOptions,
  providers,
  onChange,
}: {
  mode: AutoOptimizeMode;
  tier: AutoTier;
  config: AutoRouteConfig;
  modelOptions: AutoRouteModelOption[];
  providers: AutoRouteProviders;
  onChange: (config: AutoRouteConfig) => void;
}) {
  const cell = config.modes[mode]?.[tier];
  const candidates = useMemo(
    () => cell?.candidates ?? [],
    [cell],
  );
  const isPreset = cellMatchesPreset(mode, tier, cell);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const preset = presetTierRoute(mode, tier);

  const setCell = useCallback(
    (nextCell: AutoTierRoute | undefined) => {
      const modes = { ...config.modes };
      const modeRoutes: AutoModeRoute = { ...modes[mode] };
      if (!nextCell || cellMatchesPreset(mode, tier, nextCell)) {
        delete modeRoutes[tier];
      } else {
        modeRoutes[tier] = nextCell;
      }
      if (Object.keys(modeRoutes).length === 0) {
        delete modes[mode];
      } else {
        modes[mode] = modeRoutes;
      }
      onChange(normalizeAutoRouteConfig({ version: 2, modes }));
    },
    [config, mode, tier, onChange],
  );

  const setCandidates = useCallback(
    (nextCandidates: AutoRouteCandidate[]) => {
      setCell({
        candidates: nextCandidates,
        ...(cell?.variantFallbackOrder
          ? { variantFallbackOrder: cell.variantFallbackOrder }
          : {}),
        ...(cell?.fallback ? { fallback: cell.fallback } : {}),
      });
    },
    [cell, setCell],
  );

  const updateCandidate = useCallback(
    (index: number, candidate: AutoRouteCandidate) => {
      setCandidates(candidates.map((c, i) => (i === index ? candidate : c)));
    },
    [candidates, setCandidates],
  );

  const handleAdd = () => {
    if (candidates.length >= MAX_AUTO_ROUTE_CANDIDATES) return;
    const defaultCandidate = preset.candidates[0];
    const exists =
      defaultCandidate &&
      candidates.some(
        (c) =>
          c.kind === defaultCandidate.kind &&
          JSON.stringify(c) === JSON.stringify(defaultCandidate),
      );
    const nextCandidate: AutoRouteCandidate = exists
      ? { kind: "cost", cost: "mid" }
      : (defaultCandidate ?? { kind: "cost", cost: "mid" });
    setCandidates([...candidates, nextCandidate]);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">
            {TIER_LABEL[tier]}
            <span className="ml-1.5 text-faint">{TIER_DESCRIPTION[tier]}</span>
          </p>
        </div>
        {!isPreset && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${TIER_LABEL[tier]}をリセット`}
            onClick={() => setCell(undefined)}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>

      <p className="text-[10px] uppercase tracking-wide text-faint">
        候補（上が優先）
      </p>
      {candidates.length === 0 ? (
        <p className="text-xs text-faint">プリセットを使用中</p>
      ) : (
        <div className="space-y-1">
          {candidates.map((candidate, index) => (
            <CandidateRow
              key={index}
              index={index}
              candidate={candidate}
              providers={providers}
              modelOptions={modelOptions}
              onChange={(next) => updateCandidate(index, next)}
              onMove={(dir) =>
                setCandidates(moveItem([...candidates], index, index + dir))
              }
              onRemove={() =>
                setCandidates(candidates.filter((_, i) => i !== index))
              }
            />
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={candidates.length >= MAX_AUTO_ROUTE_CANDIDATES}
        onClick={handleAdd}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface-3 hover:text-text disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        候補を追加
      </button>

      <button
        type="button"
        aria-expanded={fallbackOpen}
        onClick={() => setFallbackOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted hover:text-text"
      >
        <ChevronDown
          className={cx(
            "h-3 w-3 transition-transform",
            fallbackOpen ? "rotate-0" : "-rotate-90",
          )}
        />
        effort フォールバック順
      </button>
      {fallbackOpen && (
        <VariantFallbackEditor
          mode={mode}
          tier={tier}
          cell={cell}
          onChange={(variantFallbackOrder) =>
            setCell({
              candidates,
              ...(variantFallbackOrder
                ? { variantFallbackOrder }
                : {}),
              ...(cell?.fallback ? { fallback: cell.fallback } : {}),
            })
          }
        />
      )}

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-faint">
          全候補が使えない時
        </p>
        <select
          aria-label={`${TIER_LABEL[tier]}のフォールバック`}
          value={cell?.fallback ?? "preset"}
          onChange={(event) =>
            setCell({
              candidates,
              ...(cell?.variantFallbackOrder
                ? { variantFallbackOrder: cell.variantFallbackOrder }
                : {}),
              fallback: event.target.value as AutoTierFallback,
            })
          }
          className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {FALLBACKS.map((fallback) => (
            <option key={fallback} value={fallback}>
              {FALLBACK_LABEL[fallback]}
            </option>
          ))}
        </select>
      </div>

      <ResolutionPreview
        mode={mode}
        tier={tier}
        config={config}
        providers={providers}
      />
    </div>
  );
}

function VariantFallbackEditor({
  mode,
  tier,
  cell,
  onChange,
}: {
  mode: AutoOptimizeMode;
  tier: AutoTier;
  cell: AutoTierRoute | undefined;
  onChange: (order: readonly IntelligenceVariant[] | undefined) => void;
}) {
  const preset = presetTierRoute(mode, tier).variantFallbackOrder ?? [];
  const explicit = cell?.variantFallbackOrder;
  const list: IntelligenceVariant[] = explicit ? [...explicit] : [...preset];
  const [isExplicit, setIsExplicit] = useState(explicit !== undefined);

  const handleToggle = (variant: IntelligenceVariant) => {
    if (!isExplicit) {
      setIsExplicit(true);
      const next = preset.includes(variant)
        ? preset.filter((v) => v !== variant)
        : [...preset, variant];
      onChange(next.length > 0 ? next : undefined);
      return;
    }
    const next = list.includes(variant)
      ? list.filter((v) => v !== variant)
      : [...list, variant];
    onChange(next.length > 0 ? next : undefined);
  };

  const handleMove = (index: number, dir: -1 | 1) => {
    onChange(moveItem(list, index, index + dir));
  };

  return (
    <div className="space-y-1">
      {ALL_INTELLIGENCE_VARIANTS.map((variant) => {
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
            {checked && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`${VARIANT_LABEL[variant]}を上へ`}
                  disabled={index <= 0}
                  onClick={() => handleMove(index, -1)}
                  className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`${VARIANT_LABEL[variant]}を下へ`}
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
      {!isExplicit && (
        <p className="text-[10px] text-faint">
          チェックを変えると個別設定を上書きします
        </p>
      )}
    </div>
  );
}

/**
 * Editor for per-mode/per-tier Auto routing candidates. Mode tabs pick the
 * mode being edited independently from the running one; each tier holds an
 * ordered candidate list (model / cost band / strongest), an effort fallback
 * order, and a fallback policy. Unchanged cells stay stored as the preset.
 */
export function AutoRouteOverridesEditor({
  mode,
  config,
  providers,
  onChange,
}: {
  /** 実行中の最適化モード。タブの初期選択と「実行中」バッジに使う */
  mode: AutoOptimizeMode;
  config: AutoRouteConfig;
  providers: AutoRouteProviders;
  onChange: (next: AutoRouteConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState<AutoOptimizeMode>(mode);
  const modelOptions = useMemo(() => autoRouteModelOptions(providers), [providers]);
  const hasAnyOverride = !isAutoRouteConfigEmpty(config);

  const setModeConfig = useCallback(
    (nextModeRoute: AutoModeRoute | undefined) => {
      const modes = { ...config.modes };
      if (!nextModeRoute || Object.keys(nextModeRoute).length === 0) {
        delete modes[editMode];
      } else {
        modes[editMode] = nextModeRoute;
      }
      onChange(normalizeAutoRouteConfig({ version: 2, modes }));
    },
    [config, editMode, onChange],
  );

  const modeHasOverride = TIERS.some(
    (tier) => !cellMatchesPreset(editMode, tier, config.modes[editMode]?.[tier]),
  );

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
          Auto ルーティング設定
        </button>
        {hasAnyOverride && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="全モードの設定をリセット"
            onClick={() =>
              onChange(normalizeAutoRouteConfig({ version: 2, modes: {} }))
            }
          >
            <RotateCcw className="h-3 w-3" />
            全リセット
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-4 rounded-lg border border-border bg-surface-2 px-3 py-3">
          <div className="flex items-center gap-1">
            {AUTO_OPTIMIZE_MODES.map((m) => {
              const selected = m === editMode;
              const isRunning = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setEditMode(m)}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-text",
                  )}
                >
                  {autoOptimizeModeLabel(m)}
                  {isRunning && <span className="ml-1">*</span>}
                </button>
              );
            })}
            {modeHasOverride && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${autoOptimizeModeLabel(editMode)}モードをリセット`}
                onClick={() => setModeConfig(undefined)}
              >
                <RotateCcw className="h-3 w-3" />
                このモードをリセット
              </Button>
            )}
          </div>
          <p className="text-xs text-faint">
            タブで編集対象のモードを選べます。未編集の tier はそのモードの初期値のまま動きます。
          </p>
          {TIERS.map((tier) => (
            <TierEditor
              key={tier}
              mode={editMode}
              tier={tier}
              config={config}
              modelOptions={modelOptions}
              providers={providers}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
