"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCcw, X } from "lucide-react";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { Button, cx } from "@/components/ui";
import { formatModelLabel, sortModelOptions, type ModelOption } from "@/lib/model-options";
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

const FALLBACK_LABEL: Record<AutoTierFallback, string> = {
  preset: "プリセットに従う",
  strongest: "最強候補にフォールバック",
  error: "エラーにする",
};

const FALLBACKS: readonly AutoTierFallback[] = ["preset", "strongest", "error"];

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

/**
 * Model dropdown options from the provider list (no Auto entry).
 * Unconnected providers / disabled models are omitted — 未接続モデルは
 * 選択肢に出さない。
 */
export function autoRouteModelOptions(providers: AutoRouteProviders): ModelOption[] {
  return sortModelOptions(
    providers.flatMap((provider) =>
      provider.enabled && provider.name
        ? provider.models
            .filter((model) => model.enabled)
            .map((model) => ({
              value: `${provider.id}::${model.id}`,
              label: formatModelLabel(model.name, model.id),
              group: provider.name,
            }))
        : [],
    ),
  );
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
 * Effort options for a candidate row, matching the Composer effort dropdown.
 * A fixed model lists only the variants it declares — an empty list hides
 * the selector, exactly like the Composer. Legacy cost / strongest rows have
 * no model yet, so the full variant list stays available there.
 */
function effortOptionsFor(
  candidate: AutoRouteCandidate,
  providers: AutoRouteProviders,
): IntelligenceVariant[] {
  if (candidate.kind === "model") {
    return modelVariantsFor(
      providers,
      candidate.providerID,
      candidate.modelID,
    );
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
  modelOptions: ModelOption[];
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

      {candidate.kind === "model" && (
        <ModelSelect
          value={`${candidate.providerID}::${candidate.modelID}`}
          options={modelOptions}
          ariaLabel={`候補${index + 1}のモデル`}
          emptyLabel="モデルなし"
          onChange={(value) => {
            const [providerID, modelID] = value.split("::");
            onChange({
              ...candidate,
              providerID: providerID ?? "",
              modelID: modelID ?? "",
            });
          }}
          className="min-w-0 flex-1"
        />
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

      {effortOptions.length > 0 && (
        <IntelligenceSelect
          variants={effortOptions}
          value={candidate.variant ?? ""}
          onChange={(next) =>
            onChange({
              ...candidate,
              variant: next === "" ? undefined : (next as IntelligenceVariant),
            })
          }
          ariaLabel={`候補${index + 1}のeffort`}
          className="h-7 shrink-0"
        />
      )}

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
  modelOptions: ModelOption[];
  providers: AutoRouteProviders;
  onChange: (config: AutoRouteConfig) => void;
}) {
  const cell = config.modes[mode]?.[tier];
  const candidates = useMemo(
    () => cell?.candidates ?? [],
    [cell],
  );
  const isPreset = cellMatchesPreset(mode, tier, cell);

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

  /** Connected models not yet listed in this tier's candidates. */
  const addableOptions = useMemo(() => {
    const used = new Set(
      candidates.flatMap((candidate) =>
        candidate.kind === "model"
          ? [`${candidate.providerID}::${candidate.modelID}`]
          : [],
      ),
    );
    return modelOptions.filter((option) => !used.has(option.value));
  }, [candidates, modelOptions]);

  const handleAdd = () => {
    if (candidates.length >= MAX_AUTO_ROUTE_CANDIDATES) return;
    const next = addableOptions[0];
    if (!next) return;
    const [providerID, modelID] = next.value.split("::");
    setCandidates([
      ...candidates,
      { kind: "model", providerID: providerID ?? "", modelID: modelID ?? "" },
    ]);
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
        disabled={
          candidates.length >= MAX_AUTO_ROUTE_CANDIDATES ||
          addableOptions.length === 0
        }
        onClick={handleAdd}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface-3 hover:text-text disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        候補を追加
      </button>

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

/**
 * Editor for per-mode/per-tier Auto routing candidates. Mode tabs pick the
 * mode being edited independently from the running one; each tier holds an
 * ordered candidate list (new rows are model-pinned — 種別は「モデル指定」に
 * 一本化; legacy cost band / strongest rows stay editable), and a fallback
 * policy（effort フォールバック順は UI から隠し、保存値をそのまま維持）。
 * Unchanged cells stay stored as the
 * preset. The model dropdown lists connected models only, and the effort
 * dropdown mirrors the Composer's.
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
