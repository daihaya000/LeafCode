"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Brain, GripVertical, Trash2 } from "lucide-react";
import { Badge, Button, cx, GhostSelect } from "@/components/ui";
import { ModelSelect } from "@/components/ModelSelect";
import { AutoOptimizeSelect } from "@/components/AutoOptimizeSelect";
import { AutoRouteOverridesEditor } from "@/components/settings/AutoRouteOverridesEditor";
import { getJson, sendJson } from "@/lib/client";
import { clearProviderModelsCache } from "@/lib/provider-models-cache";
import {
  AUTO_OPTIMIZE_SETTING_KEY,
  AUTO_ROUTE_OVERRIDES_SETTING_KEY,
  AUTO_SHOW_MODEL_SETTING_KEY,
  hasStoredAutoSetting,
  readAutoOptimizeMode,
  readAutoRouteOverrides,
  readAutoSettingsFromServer,
  readAutoShowModel,
  subscribeAutoSetting,
  writeAutoOptimizeMode,
  writeAutoRouteOverrides,
  writeAutoSettingToServer,
  writeAutoShowModel,
} from "@/lib/auto-settings";
import { AUTO_MODEL_OPTION, type AutoOptimizeMode, type RouteOverrides } from "@/lib/auto-model";
import {
  readDefaultModel,
  readDefaultModelEffort,
  readDefaultModelEffortFromServer,
  readDefaultModelFromServer,
  writeDefaultModel,
  writeDefaultModelEffort,
  writeDefaultModelEffortToServer,
  writeDefaultModelToServer,
} from "@/lib/default-model";
import {
  readGenerationModel,
  readGenerationModelEffort,
  readGenerationModelEffortFromServer,
  readGenerationModelFromServer,
  writeGenerationModel,
  writeGenerationModelEffort,
  writeGenerationModelEffortToServer,
  writeGenerationModelToServer,
} from "@/lib/generation-model";
import {
  formatModelLabel,
  sortModelOptions,
  type ModelOption,
} from "@/lib/model-options";
import {
  getIntelligenceVariants,
  isIntelligenceVariant,
  type IntelligenceVariant,
} from "@/lib/model-variants";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";
import { OpenAISubscriptionAuth } from "./OpenAISubscriptionAuth";
import { ClaudeSubscriptionAuth } from "./ClaudeSubscriptionAuth";
import { CursorCliProxyAuth } from "./CursorCliProxyAuth";
import { CommandCodeCliProxyAuth } from "./CommandCodeCliProxyAuth";

type ModelDto = {
  id: string;
  name: string;
  enabled: boolean;
  pricing?: { input: number; cachedInput?: number; cacheWrite?: number; output: number };
  variants?: Record<string, { disabled?: boolean } | undefined>;
};

type ProviderDto = {
  id: string;
  name: string;
  enabled: boolean;
  editable?: boolean;
  icon?: string;
  baseURL?: string;
  apiKeyEnv?: string;
  npm?: string;
  models: ModelDto[];
};

type ProviderModelsResponse = {
  providers: ProviderDto[];
};

type Status = "loading" | "ready" | "error";
type DragState =
  | { kind: "provider"; id: string }
  | { kind: "model"; providerId: string; id: string };

type NewProviderForm = {
  id: string;
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  icon: string;
  models: string;
};

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

function ExtensionSwitch({
  name,
  enabled,
  busy,
  onToggle,
}: {
  name: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${name} を${enabled ? "無効化" : "有効化"}`}
      disabled={busy}
      onClick={onToggle}
      className={cx(
        "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        enabled ? "bg-primary" : "bg-surface-3",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform",
          enabled ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function ProviderIcon({ provider }: { provider: ProviderDto }) {  const src = provider.icon || providerIconSrcForOpencodeId(provider.id);
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={20}
        height={20}
        className="h-5 w-5 shrink-0 rounded-[4px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="h-5 w-5 shrink-0 rounded-full border border-faint" />
  );
}

function pricingFieldValues(pricing: ModelDto["pricing"] | undefined) {
  return {
    input: pricing ? String(pricing.input) : "",
    output: pricing ? String(pricing.output) : "",
    cachedInput:
      pricing?.cachedInput !== undefined ? String(pricing.cachedInput) : "",
    cacheWrite:
      pricing?.cacheWrite !== undefined ? String(pricing.cacheWrite) : "",
  };
}

/** All known reasoning-effort keys, least to most effort. */
const ALL_EFFORT_KEYS: readonly IntelligenceVariant[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
];

/**
 * Reasoning effort (intelligence variant) selector for the default /
 * generation model settings. `""` means デフォルト（モデル側の既定値）.
 * The option list is restricted to the variants the selected model declares
 * when known, falling back to all known efforts for models without variant
 * metadata (e.g. custom OpenAI-compatible providers).
 */
function EffortSelect({
  label,
  modelKey,
  providers,
  value,
  onChange,
}: {
  label: string;
  modelKey: string;
  providers: ProviderDto[];
  value: string;
  onChange: (value: string) => void;
}) {
  const variants = useMemo(() => {
    const [providerID, modelID] = modelKey.split("::");
    const model = providers
      .flatMap((provider) =>
        provider.models.map((m) => ({ providerID: provider.id, m })),
      )
      .find(
        ({ providerID: pid, m }) => pid === providerID && m.id === modelID,
      )?.m;
    const declared = model ? getIntelligenceVariants(model) : [];
    return declared.length > 0 ? declared : ALL_EFFORT_KEYS;
  }, [modelKey, providers]);

  return (
    <GhostSelect
      value={value}
      aria-label={label}
      icon={<Brain className="h-3.5 w-3.5" />}
      valueLabel={value || "デフォルト"}
      onChange={(next) => {
        if (isIntelligenceVariant(next)) onChange(next);
        else onChange("");
      }}
      className="h-8 shrink-0"
    >
      <option value="">デフォルト</option>
      {variants.map((variant) => (
        <option key={variant} value={variant}>
          {variant}
        </option>
      ))}
    </GhostSelect>
  );
}

/**
 * Inline editor for a model's manual token pricing (USD per 1M tokens).
 * Used for models whose cost OpenCode does not report. `null` clears the
 * entry so the built-in catalog / no-estimate fallback applies.
 */
function ModelPricingEditor({
  model,
  onSave,
}: {
  model: ModelDto;
  onSave: (pricing: ModelDto["pricing"] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const initialFields = pricingFieldValues(model.pricing);
  const [input, setInput] = useState(initialFields.input);
  const [output, setOutput] = useState(initialFields.output);
  const [cachedInput, setCachedInput] = useState(initialFields.cachedInput);
  const [cacheWrite, setCacheWrite] = useState(initialFields.cacheWrite);
  const [error, setError] = useState<string | null>(null);

  // The provider list can be refreshed while this row stays mounted. Keep
  // closed editors aligned with the latest server-side pricing, then refresh
  // once more when the user opens the editor to discard stale draft values.
  useEffect(() => {
    if (open) return;
    const fields = pricingFieldValues(model.pricing);
    setInput(fields.input);
    setOutput(fields.output);
    setCachedInput(fields.cachedInput);
    setCacheWrite(fields.cacheWrite);
  }, [model.pricing, open]);

  const parse = (): ModelDto["pricing"] | null => {
    const toNum = (raw: string): number | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= 0 ? value : NaN;
    };
    const inputNum = toNum(input);
    const outputNum = toNum(output);
    if (inputNum === undefined && outputNum === undefined) return null;
    if (inputNum === undefined || outputNum === undefined || Number.isNaN(inputNum) || Number.isNaN(outputNum)) {
      setError("input と output は 0 以上の数値で入力してください");
      return undefined;
    }
    const cachedInputNum = toNum(cachedInput);
    const cacheWriteNum = toNum(cacheWrite);
    if (
      (cachedInputNum !== undefined && Number.isNaN(cachedInputNum)) ||
      (cacheWriteNum !== undefined && Number.isNaN(cacheWriteNum))
    ) {
      setError("cachedInput と cacheWrite は 0 以上の数値で入力してください");
      return undefined;
    }
    setError(null);
    return {
      input: inputNum,
      output: outputNum,
      ...(cachedInputNum !== undefined ? { cachedInput: cachedInputNum } : {}),
      ...(cacheWriteNum !== undefined ? { cacheWrite: cacheWriteNum } : {}),
    };
  };

  const save = () => {
    const pricing = parse();
    if (pricing === undefined) return;
    onSave(pricing);
    setOpen(false);
  };

  const clear = () => {
    setError(null);
    onSave(null);
    setOpen(false);
  };

  const field = "rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-muted outline-none focus:border-primary w-24";

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${model.name} の価格設定`}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const fields = pricingFieldValues(model.pricing);
            setInput(fields.input);
            setOutput(fields.output);
            setCachedInput(fields.cachedInput);
            setCacheWrite(fields.cacheWrite);
            setError(null);
          }
          setOpen((v) => !v);
        }}
      >
        {model.pricing ? "価格設定済み" : "価格設定"}
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-border bg-surface p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-muted">
            トークン価格（USD / 100万トークン）
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] text-faint">
              input
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="例: 2"
                className={field}
              />
            </label>
            <label className="grid gap-1 text-[11px] text-faint">
              output
              <input
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="例: 8"
                className={field}
              />
            </label>
            <label className="grid gap-1 text-[11px] text-faint">
              cachedInput（任意）
              <input
                value={cachedInput}
                onChange={(e) => setCachedInput(e.target.value)}
                placeholder="例: 0.5"
                className={field}
              />
            </label>
            <label className="grid gap-1 text-[11px] text-faint">
              cacheWrite（任意）
              <input
                value={cacheWrite}
                onChange={(e) => setCacheWrite(e.target.value)}
                placeholder="例: 2.5"
                className={field}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save}>
              保存
            </Button>
            {model.pricing && (
              <Button variant="ghost" size="sm" onClick={clear}>
                クリア
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              閉じる
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderGroup({
  provider,
  busyId,
  deleting,
  onToggleProvider,
  onToggleModel,
  onEditProvider,
  onDeleteProvider,
  onDragStartProvider,
  onDropProvider,
  onDragStartModel,
  onDropModel,
  onSaveModelPricing,
}: {
  provider: ProviderDto;
  busyId: string | null;
  deleting: boolean;
  onToggleProvider: (enabled: boolean) => void;
  onToggleModel: (model: ModelDto, enabled: boolean) => void;
  onEditProvider: () => void;
  onDeleteProvider: () => void;
  onDragStartProvider: () => void;
  onDropProvider: () => void;
  onDragStartModel: (model: ModelDto) => void;
  onDropModel: (model: ModelDto) => void;
  onSaveModelPricing: (model: ModelDto, pricing: ModelDto["pricing"] | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const isBusy = busyId === provider.id;
  const hasModels = provider.models.length > 0;

  return (
    <li
      aria-busy={isBusy || undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStartProvider();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDropProvider();
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <GripVertical
          aria-label={`${provider.name} をドラッグして並び替え`}
          className="h-4 w-4 shrink-0 cursor-grab text-faint"
        />
        {hasModels && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${provider.name} のモデルを${expanded ? "折りたたむ" : "展開"}`}
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-surface-3 hover:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={cx(
                "h-4 w-4 transition-transform",
                expanded ? "rotate-90" : "rotate-0",
              )}
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        <ProviderIcon provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              {provider.name}
            </p>
            <Badge tone={provider.enabled ? "success" : "neutral"}>
              {provider.enabled ? "有効" : "無効"}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            provider.editable
              ? `${provider.name}を編集`
              : `${provider.name}のアイコンを編集`
          }
          onClick={onEditProvider}
        >
          {provider.editable ? "編集" : "アイコン編集"}
        </Button>
        {provider.editable && (
          <button
            type="button"
            disabled={deleting}
            aria-label={`${provider.name} を削除`}
            aria-busy={deleting || undefined}
            onClick={onDeleteProvider}
            className="min-h-8 min-w-8 shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <ExtensionSwitch
          name={provider.name}
          enabled={provider.enabled}
          busy={isBusy}
          onToggle={() => onToggleProvider(!provider.enabled)}
        />
      </div>
      {hasModels && expanded && (
        <ul id={panelId} className="space-y-2">
          {provider.models.map((model) => {
            const modelKey = `${provider.id}::${model.id}`;
            const modelBusy = busyId === modelKey;
            const disabled = !provider.enabled;
            return (
              <li
                key={model.id}
                draggable={!disabled}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  onDragStartModel(model);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDropModel(model);
                }}
                aria-busy={modelBusy || undefined}
                className={cx(
                  "ml-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 border-l-2 border-l-border",
                  disabled && "opacity-50",
                )}
              >
                <GripVertical
                  aria-label={`${model.name} をドラッグして並び替え`}
                  className="h-4 w-4 shrink-0 cursor-grab text-faint"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {model.name}
                    </p>
                    <Badge tone={model.enabled ? "success" : "neutral"}>
                      {model.enabled ? "有効" : "無効"}
                    </Badge>
                  </div>
                </div>
                <ModelPricingEditor
                  model={model}
                  onSave={(pricing) => onSaveModelPricing(model, pricing)}
                />
                <ExtensionSwitch
                  name={model.name}
                  enabled={model.enabled}
                  busy={modelBusy || disabled}
                  onToggle={() => onToggleModel(model, !model.enabled)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function ProviderModelsSettings() {
  const [status, setStatus] = useState<Status>("loading");
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [defaultModelEffort, setDefaultModelEffort] = useState<string>("");
  const [generationModel, setGenerationModel] = useState<string>("");
  const [generationModelEffort, setGenerationModelEffort] = useState<string>("");
  const [autoOptimize, setAutoOptimize] = useState<AutoOptimizeMode>(() =>
    readAutoOptimizeMode(),
  );
  const [autoShowModel, setAutoShowModel] = useState(() => readAutoShowModel());
  const [routeOverrides, setRouteOverrides] = useState<RouteOverrides>(() =>
    readAutoRouteOverrides(),
  );
  const autoSettingsTouched = useRef({
    mode: false,
    showModel: false,
    routeOverrides: false,
  });
  const defaultModelTouched = useRef(false);
  const defaultModelEffortTouched = useRef(false);
  const generationModelTouched = useRef(false);
  const generationModelEffortTouched = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<ProviderDto | null>(null);
  const providerMutationRef = useRef(false);
  const deleteConfirmRef = useRef<HTMLDivElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const toggleBusyRef = useRef(false);
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const orderQueueRef = useRef(Promise.resolve());
  const orderPendingRef = useRef(0);
  const [orderSaving, setOrderSaving] = useState(false);
  const [newProvider, setNewProvider] = useState<NewProviderForm>({
    id: "",
    name: "",
    baseURL: "",
    apiKeyEnv: "",
    icon: "",
    models: "",
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const serverValue = await readDefaultModelFromServer().catch(() => null);
      const localValue = readDefaultModel();
      const touched = defaultModelTouched.current;
      // DB優先。DBにあればそれ、なければlocalStorage。
      const resolved = touched ? localValue ?? "" : serverValue ?? localValue ?? "";
      if (!active) return;
      setDefaultModel(resolved);
      // DB値を localStorage へも反映（他画面/他ブラウザで開いた時の同期源）。
      if (!touched && serverValue && serverValue !== localValue) {
        writeDefaultModel(serverValue);
      }
      // DBに無くlocalStorageにある場合はDBへ保存（マイグレーション）。
      if (!touched && serverValue == null && localValue) {
        await writeDefaultModelToServer(localValue).catch(() => undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const serverValue = await readDefaultModelEffortFromServer().catch(
        () => null,
      );
      const localValue = readDefaultModelEffort();
      const touched = defaultModelEffortTouched.current;
      const resolved = touched
        ? localValue ?? ""
        : serverValue ?? localValue ?? "";
      if (!active) return;
      setDefaultModelEffort(resolved);
      if (!touched && serverValue && serverValue !== localValue) {
        writeDefaultModelEffort(serverValue);
      }
      if (!touched && serverValue == null && localValue) {
        await writeDefaultModelEffortToServer(localValue).catch(
          () => undefined,
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onMode = () => {
      autoSettingsTouched.current.mode = true;
      setAutoOptimize(readAutoOptimizeMode());
    };
    const onShowModel = () => {
      autoSettingsTouched.current.showModel = true;
      setAutoShowModel(readAutoShowModel());
    };
    const onRouteOverrides = () => {
      autoSettingsTouched.current.routeOverrides = true;
      setRouteOverrides(readAutoRouteOverrides());
    };
    const unsubscribeMode = subscribeAutoSetting(
      AUTO_OPTIMIZE_SETTING_KEY,
      onMode,
    );
    const unsubscribeShowModel = subscribeAutoSetting(
      AUTO_SHOW_MODEL_SETTING_KEY,
      onShowModel,
    );
    const unsubscribeRouteOverrides = subscribeAutoSetting(
      AUTO_ROUTE_OVERRIDES_SETTING_KEY,
      onRouteOverrides,
    );
    return () => {
      unsubscribeMode();
      unsubscribeShowModel();
      unsubscribeRouteOverrides();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const snapshot = await readAutoSettingsFromServer();
      // Keep a local choice authoritative, as HomeView and TaskView do.
      // Server-only values are hydrated into localStorage for other screens.
      if (
        snapshot.mode &&
        !autoSettingsTouched.current.mode &&
        !hasStoredAutoSetting(AUTO_OPTIMIZE_SETTING_KEY)
      ) {
        writeAutoOptimizeMode(snapshot.mode);
        setAutoOptimize(snapshot.mode);
      }
      if (
        snapshot.showModel !== undefined &&
        !autoSettingsTouched.current.showModel &&
        !hasStoredAutoSetting(AUTO_SHOW_MODEL_SETTING_KEY)
      ) {
        writeAutoShowModel(snapshot.showModel);
        setAutoShowModel(snapshot.showModel);
      }
      if (
        snapshot.routeOverrides &&
        !autoSettingsTouched.current.routeOverrides &&
        !hasStoredAutoSetting(AUTO_ROUTE_OVERRIDES_SETTING_KEY)
      ) {
        writeAutoRouteOverrides(snapshot.routeOverrides);
        setRouteOverrides(snapshot.routeOverrides);
      }
    })();
  }, []);

  const modelOptions: ModelOption[] = [AUTO_MODEL_OPTION, ...sortModelOptions(
    providers.flatMap((provider) =>
      provider.models
        .filter((model) => provider.enabled && model.enabled)
        .map((model) => ({
          value: `${provider.id}::${model.id}`,
          label: formatModelLabel(model.name, model.id),
          group: provider.name || provider.id,
        })),
    ),)];

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setStatus("loading");
    setError(null);
    try {
      const data = await getJson<ProviderModelsResponse>(
        "/api/extensions/provider-models",
      );
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setProviders(data.providers ?? []);
      setStatus("ready");
    } catch (err) {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (key: string, enabled: boolean) => {
      if (toggleBusyRef.current) return;
      toggleBusyRef.current = true;
      setBusyId(key);
      setActionError(null);
      try {
        clearProviderModelsCache();
        await sendJson(
          "PATCH",
          `/api/extensions/provider-models/${encodeURIComponent(key)}`,
          { enabled },
        );
        // Optimistic update: reflect the change in the local list without a
        // full reload so expanded rows stay open and the list never flashes
        // to "読み込み中…". Toggling a provider also flips its models.
        if (!mountedRef.current) return;
        setProviders((prev) =>
          prev.map((p) => {
            if (key === p.id) {
              const providerEnabled = enabled;
              return {
                ...p,
                enabled: providerEnabled,
                models: p.models.map((m) => ({
                  ...m,
                  // Keep the prior model enabled state when the provider turns
                  // on, and force all off when the provider turns off.
                  enabled: providerEnabled && m.enabled,
                })),
              };
            }
            if (key.startsWith(`${p.id}::`)) {
              const modelID = key.slice(p.id.length + 2);
              return {
                ...p,
                models: p.models.map((m) =>
                  m.id === modelID
                    ? { ...m, enabled: p.enabled && enabled }
                    : m,
                ),
              };
            }
            return p;
          }),
        );
      } catch (err) {
        if (mountedRef.current) setActionError(err instanceof Error ? err.message : "操作に失敗しました");
        // On failure, resync from the server so the UI reflects the real state.
        if (mountedRef.current) void load();
      } finally {
        toggleBusyRef.current = false;
        if (mountedRef.current) setBusyId(null);
      }
    },
    [load],
  );

  const saveModelPricing = useCallback(
    async (providerId: string, model: ModelDto, pricing: ModelDto["pricing"] | null) => {
      const key = `${providerId}::${model.id}`;
      setBusyId(key);
      setActionError(null);
      try {
        clearProviderModelsCache();
        await sendJson("PATCH", `/api/extensions/provider-models/${encodeURIComponent(key)}`, {
          pricing,
        });
        if (!mountedRef.current) return;
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  models: p.models.map((m) =>
                    m.id === model.id ? { ...m, pricing: pricing ?? undefined } : m,
                  ),
                }
              : p,
          ),
        );
      } catch (err) {
        if (mountedRef.current) setActionError(err instanceof Error ? err.message : "価格設定の保存に失敗しました");
      } finally {
        if (mountedRef.current) setBusyId(null);
      }
    },
    [],
  );

  const saveOrder = useCallback((nextProviders: ProviderDto[]) => {    orderPendingRef.current += 1;
    setOrderSaving(true);
    const operation = orderQueueRef.current.then(async () => {
      if (!mountedRef.current) return;
      setActionError(null);
      try {
        clearProviderModelsCache();
        await sendJson("PATCH", "/api/extensions/provider-models/order", {
          providerOrder: nextProviders.map((provider) => provider.id),
          modelOrder: Object.fromEntries(
            nextProviders.map((provider) => [
              provider.id,
              provider.models.map((model) => model.id),
            ]),
          ),
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "並び順の保存に失敗しました");
        void load();
      }
    });
    orderQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    void operation.finally(() => {
      orderPendingRef.current -= 1;
      if (mountedRef.current && orderPendingRef.current === 0) setOrderSaving(false);
    });
  }, [load]);

  const moveProvider = useCallback(
    (targetId: string) => {
      if (dragging?.kind !== "provider" || dragging.id === targetId) return;
      setProviders((prev) => {
        const from = prev.findIndex((provider) => provider.id === dragging.id);
        const to = prev.findIndex((provider) => provider.id === targetId);
        const next = moveItem(prev, from, to);
        void saveOrder(next);
        return next;
      });
      setDragging(null);
    },
    [dragging, saveOrder],
  );

  const moveModel = useCallback(
    (providerId: string, targetId: string) => {
      if (
        dragging?.kind !== "model" ||
        dragging.providerId !== providerId ||
        dragging.id === targetId
      ) {
        return;
      }
      setProviders((prev) => {
        const next = prev.map((provider) => {
          if (provider.id !== providerId) return provider;
          const from = provider.models.findIndex((model) => model.id === dragging.id);
          const to = provider.models.findIndex((model) => model.id === targetId);
          return { ...provider, models: moveItem(provider.models, from, to) };
        });
        void saveOrder(next);
        return next;
      });
      setDragging(null);
    },
    [dragging, saveOrder],
  );

  const resetProviderForm = useCallback(() => {
    setEditingProviderId(null);
    setNewProvider({ id: "", name: "", baseURL: "", apiKeyEnv: "", icon: "", models: "" });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const serverValue = await readGenerationModelFromServer();
      const localValue = readGenerationModel();
      const resolved = generationModelTouched.current
        ? localValue ?? ""
        : serverValue ?? localValue ?? "";
      if (!active) return;
      setGenerationModel(resolved);
      if (!generationModelTouched.current && serverValue && serverValue !== localValue) {
        writeGenerationModel(serverValue);
      } else if (!generationModelTouched.current && !serverValue && localValue) {
        await writeGenerationModelToServer(localValue);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const serverValue = await readGenerationModelEffortFromServer().catch(
        () => null,
      );
      const localValue = readGenerationModelEffort();
      const resolved = generationModelEffortTouched.current
        ? localValue ?? ""
        : serverValue ?? localValue ?? "";
      if (!active) return;
      setGenerationModelEffort(resolved);
      if (
        !generationModelEffortTouched.current &&
        serverValue &&
        serverValue !== localValue
      ) {
        writeGenerationModelEffort(serverValue);
      } else if (
        !generationModelEffortTouched.current &&
        !serverValue &&
        localValue
      ) {
        await writeGenerationModelEffortToServer(localValue).catch(
          () => undefined,
        );
      }
    })();
    return () => { active = false; };
  }, []);

  /**
   * 取得済みのローカルモデルをそのまま登録する。手入力フォームでは
   * 画像入力対応（`attachment` / `modalities`）を表現できず、VLモデルが
   * 画像非対応として登録されてしまうため、専用APIへ委譲する。
   */
  const registerOllama = useCallback(async () => {
    if (providerMutationRef.current) return;
    providerMutationRef.current = true;
    setEditingProviderId(null);
    setAddBusy(true);
    setAddMessage(null);
    setActionError(null);
    try {
      clearProviderModelsCache();
      const result = await sendJson<{ models?: string[]; visionModels?: string[] }>(
        "POST",
        "/api/ollama/register",
        {},
      );
      if (!mountedRef.current) return;
      const total = result.models?.length ?? 0;
      const vision = result.visionModels?.length ?? 0;
      setAddMessage(
        `ローカルOllamaの${total}件のモデルを登録しました（画像対応${vision}件）。LeafCode の再起動後に利用できます。`,
      );
      await load();
    } catch (err) {
      if (mountedRef.current) {
        setActionError(err instanceof Error ? err.message : "Ollamaの登録に失敗しました");
      }
    } finally {
      providerMutationRef.current = false;
      if (mountedRef.current) setAddBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (!deleteConfirmProvider) {
      if (
        deleteTriggerRef.current?.isConnected &&
        (document.activeElement === document.body || document.activeElement === null)
      ) {
        deleteTriggerRef.current.focus();
      }
      deleteTriggerRef.current = null;
      return;
    }
    deleteConfirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDeleteConfirmProvider(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmProvider]);

  const editProvider = useCallback((provider: ProviderDto) => {
    setAddOpen(true);
    setEditingProviderId(provider.id);
    setAddMessage(null);
    setActionError(null);
    setNewProvider({
      id: provider.id,
      name: provider.name,
      baseURL: provider.baseURL ?? "",
      apiKeyEnv: provider.apiKeyEnv ?? "",
      icon: provider.icon ?? "",
      models: provider.models
        .map((model) => `${model.id}|${model.name}`)
        .join("\n"),
    });
  }, []);

  const deleteProvider = useCallback(
    async (provider: ProviderDto) => {
      if (providerMutationRef.current) return;
      setDeleteConfirmProvider(null);
      providerMutationRef.current = true;
      setDeletingProviderId(provider.id);
      setActionError(null);
      try {
        clearProviderModelsCache();
        await sendJson(
          "DELETE",
          `/api/extensions/provider-models/${encodeURIComponent(provider.id)}`,
        );
        if (!mountedRef.current) return;
        setProviders((prev) => prev.filter((p) => p.id !== provider.id));
        if (editingProviderId === provider.id) resetProviderForm();
      } catch (err) {
        if (mountedRef.current) setActionError(err instanceof Error ? err.message : "削除に失敗しました");
      } finally {
        providerMutationRef.current = false;
        if (mountedRef.current) setDeletingProviderId(null);
      }
    },
    [editingProviderId, resetProviderForm],
  );

  // Built-in providers (openai/anthropic/…) have no opencode.jsonc entry to
  // edit; when editing one of those, only the WebUI-local icon override can
  // be changed here.
  const editingProvider = editingProviderId
    ? providers.find((p) => p.id === editingProviderId) ?? null
    : null;
  const iconOnlyEdit = editingProvider !== null && !editingProvider.editable;

  const saveProvider = useCallback(async () => {
    if (providerMutationRef.current) return;
    providerMutationRef.current = true;
    if (editingProviderId && iconOnlyEdit) {
      setAddBusy(true);
      setActionError(null);
      setAddMessage(null);
      try {
        clearProviderModelsCache();
        await sendJson(
          "PATCH",
          `/api/extensions/provider-models/${encodeURIComponent(editingProviderId)}`,
          { icon: newProvider.icon.trim() || null },
        );
        if (!mountedRef.current) return;
        setAddMessage("アイコンを更新しました。");
        resetProviderForm();
        await load();
      } catch (err) {
        if (mountedRef.current) setActionError(err instanceof Error ? err.message : "保存に失敗しました");
      } finally {
        providerMutationRef.current = false;
        if (mountedRef.current) setAddBusy(false);
      }
      return;
    }

    const models = newProvider.models
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, ...nameParts] = line.split("|");
        return { id: id?.trim() ?? "", name: nameParts.join("|").trim() };
      });
    setAddBusy(true);
    setActionError(null);
    setAddMessage(null);
    try {
      clearProviderModelsCache();
      const body = {
        id: newProvider.id,
        name: newProvider.name,
        baseURL: newProvider.baseURL,
        apiKeyEnv: newProvider.apiKeyEnv || undefined,
        icon: newProvider.icon || undefined,
        models,
      };
      if (editingProviderId) {
        await sendJson(
          "PUT",
          `/api/extensions/provider-models/${encodeURIComponent(editingProviderId)}`,
          body,
        );
      } else {
        await sendJson("POST", "/api/extensions/provider-models", body);
      }
      if (!mountedRef.current) return;
      setAddMessage(
        editingProviderId
          ? "更新しました。LeafCode の再起動後に反映されます。"
          : "登録しました。LeafCode の再起動後に利用できます。",
      );
      resetProviderForm();
      await load();
    } catch (err) {
      if (mountedRef.current) setActionError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      providerMutationRef.current = false;
      if (mountedRef.current) setAddBusy(false);
    }
  }, [editingProviderId, iconOnlyEdit, load, newProvider, resetProviderForm]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="default-model-heading">
        <h2
          id="default-model-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          デフォルトモデル
        </h2>
        <p className="mb-3 text-xs text-faint">
          新規タスク作成時の初期モデルです。各タスクで個別に上書きできます。
        </p>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          {status === "loading" ? (
            <p className="text-sm text-faint">モデルを読み込み中…</p>
          ) : modelOptions.length === 0 ? (
            <p className="text-sm text-faint">
              利用可能なモデルがありません。プロバイダー/モデルの有効化を確認してください。
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ModelSelect
                value={defaultModel}
                options={modelOptions}
                ariaLabel="デフォルトモデル"
                emptyLabel="選択してください"
                onChange={(v) => {
                  defaultModelTouched.current = true;
                  setDefaultModel(v);
                  writeDefaultModel(v || null);
                  void writeDefaultModelToServer(v || null).catch(
                    () => undefined,
                  );
                }}
                className="min-w-56 flex-1"
              />
              {defaultModel && defaultModel !== AUTO_MODEL_OPTION.value && (
                <EffortSelect
                  label="デフォルトモデルのEffort"
                  modelKey={defaultModel}
                  providers={providers}
                  value={defaultModelEffort}
                  onChange={(effort) => {
                    defaultModelEffortTouched.current = true;
                    const next = effort || "";
                    setDefaultModelEffort(next);
                    writeDefaultModelEffort(next || null);
                    void writeDefaultModelEffortToServer(next || null).catch(
                      () => undefined,
                    );
                  }}
                />
              )}
              {defaultModel && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="デフォルトをクリア"
                  onClick={() => {
                    defaultModelTouched.current = true;
                    setDefaultModel("");
                    writeDefaultModel(null);
                    void writeDefaultModelToServer(null).catch(() => undefined);
                  }}
                >
                  クリア
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="generation-model-heading">
        <h2 id="generation-model-heading" className="mb-3 text-sm font-semibold text-muted">
          タイトル / NextAction 生成モデル
        </h2>
        <p className="mb-3 text-xs text-faint">
          会話タイトルと次のアクションの提案に使うモデルです。未設定時は従来のモデル選択を使います。
        </p>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModelSelect
              value={generationModel}
              options={modelOptions.filter((option) => option.value !== AUTO_MODEL_OPTION.value)}
              ariaLabel="タイトル / NextAction 生成モデル"
              emptyLabel="選択してください"
              onChange={(value) => {
                generationModelTouched.current = true;
                setGenerationModel(value);
                writeGenerationModel(value || null);
                void writeGenerationModelToServer(value || null);
              }}
              className="min-w-56 flex-1"
            />
            {generationModel && (
              <EffortSelect
                label="生成モデルのEffort"
                modelKey={generationModel}
                providers={providers}
                value={generationModelEffort}
                onChange={(effort) => {
                  generationModelEffortTouched.current = true;
                  const next = effort || "";
                  setGenerationModelEffort(next);
                  writeGenerationModelEffort(next || null);
                  void writeGenerationModelEffortToServer(next || null).catch(
                    () => undefined,
                  );
                }}
              />
            )}
            {generationModel && (
              <Button
                variant="ghost"
                size="sm"
                title="生成モデルをクリア"
                onClick={() => {
                  generationModelTouched.current = true;
                  setGenerationModel("");
                  writeGenerationModel(null);
                  void writeGenerationModelToServer(null);
                }}
              >
                クリア
              </Button>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="auto-settings-heading">
        <h2
          id="auto-settings-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          Autoモード
        </h2>
        <p className="mb-3 text-xs text-faint">
          Autoがタスクに合ったモデルを選ぶときの動作を設定します。
        </p>
        <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-muted">最適化モード</p>
              <p className="mt-1 text-xs text-faint">
                コスト、バランス、知能のどれを優先するかを選びます。
              </p>
            </div>
            <AutoOptimizeSelect
              value={autoOptimize}
              disabled={false}
              onChange={(mode) => {
                autoSettingsTouched.current.mode = true;
                setAutoOptimize(mode);
                writeAutoOptimizeMode(mode);
                void writeAutoSettingToServer(AUTO_OPTIMIZE_SETTING_KEY, mode);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-muted">
                Autoが選んだモデル名を表示
              </p>
              <p className="mt-1 text-xs text-faint">
                タスク画面で実際に選ばれたモデル名を表示します。
              </p>
            </div>
            <ExtensionSwitch
              name="Autoが選んだモデル名を表示"
              enabled={autoShowModel}
              busy={false}
              onToggle={() => {
                const next = !autoShowModel;
                autoSettingsTouched.current.showModel = true;
                setAutoShowModel(next);
                writeAutoShowModel(next);
                void writeAutoSettingToServer(
                  AUTO_SHOW_MODEL_SETTING_KEY,
                  next ? "1" : "",
                );
              }}
            />
          </div>
          <div className="py-3">
            <AutoRouteOverridesEditor
              mode={autoOptimize}
              overrides={routeOverrides}
              onChange={(next) => {
                autoSettingsTouched.current.routeOverrides = true;
                setRouteOverrides(next);
                writeAutoRouteOverrides(next);
                void writeAutoSettingToServer(
                  AUTO_ROUTE_OVERRIDES_SETTING_KEY,
                  Object.keys(next).length === 0 ? "" : JSON.stringify(next),
                );
              }}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="provider-models-heading">
        <h2
          id="provider-models-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          プロバイダー/モデル
        </h2>
        <p className="mb-3 text-xs text-faint">
          利用可能な AI プロバイダーとモデルの表示を切り替えます。LeafCode
          設定ファイルに新規プロバイダーを追加できます。
        </p>
        {orderSaving && (
          <p className="mb-3 text-xs text-muted" role="status" aria-live="polite">
            並び順を保存中…
          </p>
        )}
        <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-muted">
                {editingProviderId
                  ? iconOnlyEdit
                    ? "アイコン編集"
                    : "プロバイダー設定編集"
                  : "新規プロバイダー"}
              </h3>
              <p className="mt-1 text-xs text-faint">
                {iconOnlyEdit
                  ? "組み込みプロバイダーは名前やモデルを変更できませんが、アイコンだけはこの画面から上書きできます。"
                  : "OpenAI 互換 API を opencode.jsonc の provider に追加します。APIキーは環境変数参照で保存します。"}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (addOpen) resetProviderForm();
                setAddOpen((v) => !v);
              }}
            >
              {addOpen ? "閉じる" : "登録"}
            </Button>
          </div>
          {!addOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              disabled={addBusy}
              onClick={() => void registerOllama()}
            >
              ローカルOllamaを登録
            </Button>
          )}
          {!addOpen && addMessage && (
            <p className="mt-2 text-xs text-success">{addMessage}</p>
          )}
          {addOpen && (
            <div className="mt-4 grid gap-3">
              {iconOnlyEdit && editingProvider && (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-faint">
                  <span className="font-medium text-muted">
                    {editingProvider.name}
                  </span>{" "}
                  <span>({editingProvider.id})</span>
                </div>
              )}
              {!iconOnlyEdit && (
                <>
                  <label className="grid gap-1 text-xs text-faint">
                    プロバイダーID
                    <input
                      value={newProvider.id}
                      disabled={!!editingProviderId}
                      onChange={(e) => setNewProvider((v) => ({ ...v, id: e.target.value }))}
                      placeholder="myprovider"
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-faint">
                    表示名
                    <input
                      value={newProvider.name}
                      onChange={(e) => setNewProvider((v) => ({ ...v, name: e.target.value }))}
                      placeholder="My AI Provider"
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-faint">
                    Base URL
                    <input
                      value={newProvider.baseURL}
                      onChange={(e) => setNewProvider((v) => ({ ...v, baseURL: e.target.value }))}
                      placeholder="https://api.example.com/v1"
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-faint">
                    APIキー環境変数（任意）
                    <input
                      value={newProvider.apiKeyEnv}
                      onChange={(e) => setNewProvider((v) => ({ ...v, apiKeyEnv: e.target.value }))}
                      placeholder="MY_PROVIDER_API_KEY"
                      className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                    />
                  </label>
                </>
              )}
              <label className="grid gap-1 text-xs text-faint">
                アイコンURL/パス（任意）
                <input
                  value={newProvider.icon}
                  onChange={(e) => setNewProvider((v) => ({ ...v, icon: e.target.value }))}
                  placeholder="https://example.com/icon.png または /icons/myprovider.png"
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                />
              </label>
              {!iconOnlyEdit && (
                <label className="grid gap-1 text-xs text-faint">
                  モデル（1行1件: model-id|表示名）
                  <textarea
                    value={newProvider.models}
                    onChange={(e) => setNewProvider((v) => ({ ...v, models: e.target.value }))}
                    placeholder={"my-model|My Model"}
                    rows={3}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                  />
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={addBusy} onClick={() => void saveProvider()}>
                  {addBusy
                    ? "保存中…"
                    : iconOnlyEdit
                      ? "アイコンを保存"
                      : editingProviderId
                        ? "設定を保存"
                        : "プロバイダーを登録"}
                </Button>
                {editingProviderId && (
                  <Button variant="ghost" size="sm" onClick={resetProviderForm}>
                    新規登録に戻す
                  </Button>
                )}
                {addMessage && <p className="text-xs text-success">{addMessage}</p>}
              </div>
            </div>
          )}
        </div>
        {deleteConfirmProvider && (
          <div
            ref={deleteConfirmRef}
            role="alertdialog"
            aria-label="プロバイダー削除の確認"
            aria-describedby="provider-delete-confirm-description"
            className="mb-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-3 text-sm text-danger"
          >
            <p id="provider-delete-confirm-description">
              プロバイダー「{deleteConfirmProvider.name}」を削除しますか？
              <br />
              opencode.jsoncから削除され、LeafCodeの再起動後に反映されます。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void deleteProvider(deleteConfirmProvider)}
              >
                削除する
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmProvider(null)}
              >
                キャンセル
              </Button>
            </div>
          </div>
        )}
        {actionError && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {actionError}
          </p>
        )}
        {status === "loading" && (
          <p
            aria-busy="true"
            className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted"
          >
            読み込み中…
          </p>
        )}
        {status === "error" && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-4 text-sm"
          >
            <p className="text-muted">{error ?? "取得に失敗しました"}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              再試行
            </Button>
          </div>
        )}
        {status === "ready" &&
          (providers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              利用可能なプロバイダーがありません
            </p>
          ) : (
            <ul className="space-y-2">
              {providers.map((provider) => (
                <ProviderGroup
                  key={provider.id}
                  provider={provider}
                  busyId={busyId}
                  deleting={deletingProviderId === provider.id}
                  onDragStartProvider={() =>
                    setDragging({ kind: "provider", id: provider.id })
                  }
                  onDropProvider={() => moveProvider(provider.id)}
                  onDragStartModel={(model) =>
                    setDragging({
                      kind: "model",
                      providerId: provider.id,
                      id: model.id,
                    })
                  }
                  onDropModel={(model) => moveModel(provider.id, model.id)}
                  onToggleProvider={(enabled) =>
                    void toggle(provider.id, enabled)
                  }
                  onEditProvider={() => editProvider(provider)}
                  onDeleteProvider={() => {
                    deleteTriggerRef.current = document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                    setDeleteConfirmProvider(provider);
                  }}
                  onToggleModel={(model, enabled) =>
                    void toggle(`${provider.id}::${model.id}`, enabled)
                  }
                  onSaveModelPricing={(model, pricing) =>
                    void saveModelPricing(provider.id, model, pricing)
                  }
                />
              ))}
            </ul>
          ))}
      </section>

      {(providers.some((provider) => provider.id === "openai") ||
        providers.some((provider) => provider.id === "anthropic")) && (
        <section aria-labelledby="subscriptions-heading">
          <h2
            id="subscriptions-heading"
            className="mb-3 text-sm font-semibold text-muted"
          >
            サブスクリプション
          </h2>
          <div className="space-y-3">
            {providers.some((provider) => provider.id === "openai") && (
              <OpenAISubscriptionAuth showHeading={false} />
            )}
          </div>
        </section>
      )}
      {(providers.some((provider) => provider.id === "cursor") ||
        providers.some((provider) => provider.id === "anthropic") ||
        providers.some((provider) => provider.id === "opencommand") ||
        providers.some((provider) => provider.id === "commandcode")) && (
        <section aria-labelledby="cli-proxy-heading">
          <h2 id="cli-proxy-heading" className="mb-3 text-sm font-semibold text-muted">CLI Proxy</h2>
          <div className="space-y-3">
            {providers.some((provider) => provider.id === "cursor") && <CursorCliProxyAuth showHeading={false} />}
            {providers.some((provider) => provider.id === "anthropic") && <ClaudeSubscriptionAuth showHeading={false} />}
            {(providers.some((provider) => provider.id === "opencommand") || providers.some((provider) => provider.id === "commandcode")) && <CommandCodeCliProxyAuth showHeading={false} />}
          </div>
        </section>
      )}
    </div>
  );
}
