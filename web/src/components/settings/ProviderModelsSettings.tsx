"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { GripVertical } from "lucide-react";
import { Badge, Button, GhostSelect, cx } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";
import {
  readDefaultModel,
  readDefaultModelFromServer,
  writeDefaultModel,
  writeDefaultModelToServer,
} from "@/lib/default-model";
import {
  formatModelLabel,
  sortModelOptions,
  type ModelOption,
} from "@/lib/model-options";
import { providerIconSrcForOpencodeId } from "@addons/codexbar";

type ModelDto = {
  id: string;
  name: string;
  enabled: boolean;
};

type ProviderDto = {
  id: string;
  name: string;
  enabled: boolean;
  models: ModelDto[];
};

type ProviderModelsResponse = {
  providers: ProviderDto[];
};

type Status = "loading" | "ready" | "error";
type DragState =
  | { kind: "provider"; id: string }
  | { kind: "model"; providerId: string; id: string };

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

function ProviderIcon({ providerId }: { providerId: string }) {
  const src = providerIconSrcForOpencodeId(providerId);
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

function DefaultModelIcon({ model }: { model: string }) {
  const providerID = model ? model.split("::")[0] : "";
  const src = providerIconSrcForOpencodeId(providerID);
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-faint" />;
}

function ProviderGroup({
  provider,
  busyId,
  onToggleProvider,
  onToggleModel,
  onDragStartProvider,
  onDropProvider,
  onDragStartModel,
  onDropModel,
}: {
  provider: ProviderDto;
  busyId: string | null;
  onToggleProvider: (enabled: boolean) => void;
  onToggleModel: (model: ModelDto, enabled: boolean) => void;
  onDragStartProvider: () => void;
  onDropProvider: () => void;
  onDragStartModel: (model: ModelDto) => void;
  onDropModel: (model: ModelDto) => void;
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
        <ProviderIcon providerId={provider.id} />
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

  useEffect(() => {
    void (async () => {
      const serverValue = await readDefaultModelFromServer().catch(() => null);
      const localValue = readDefaultModel();
      // DB優先。DBにあればそれ、なければlocalStorage。
      const resolved = serverValue ?? localValue ?? "";
      setDefaultModel(resolved);
      // DB値を localStorage へも反映（他画面/他ブラウザで開いた時の同期源）。
      if (serverValue && serverValue !== localValue) {
        writeDefaultModel(serverValue);
      }
      // DBに無くlocalStorageにある場合はDBへ保存（マイグレーション）。
      if (serverValue == null && localValue) {
        await writeDefaultModelToServer(localValue).catch(() => undefined);
      }
    })();
  }, []);

  const modelOptions: ModelOption[] = sortModelOptions(
    providers.flatMap((provider) =>
      provider.models
        .filter((model) => provider.enabled && model.enabled)
        .map((model) => ({
          value: `${provider.id}::${model.id}`,
          label: formatModelLabel(model.name, model.id),
          group: provider.name || provider.id,
        })),
    ),
  );

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await getJson<ProviderModelsResponse>(
        "/api/extensions/provider-models",
      );
      setProviders(data.providers ?? []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (key: string, enabled: boolean) => {
      setBusyId(key);
      setActionError(null);
      try {
        await sendJson(
          "PATCH",
          `/api/extensions/provider-models/${encodeURIComponent(key)}`,
          { enabled },
        );
        // Optimistic update: reflect the change in the local list without a
        // full reload so expanded rows stay open and the list never flashes
        // to "読み込み中…". Toggling a provider also flips its models.
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
        setActionError(err instanceof Error ? err.message : "操作に失敗しました");
        // On failure, resync from the server so the UI reflects the real state.
        void load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const saveOrder = useCallback(async (nextProviders: ProviderDto[]) => {
    setActionError(null);
    try {
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
              <GhostSelect
                value={defaultModel}
                aria-label="デフォルトモデル"
                icon={<DefaultModelIcon model={defaultModel} />}
                valueLabel={
                  modelOptions.find((o) => o.value === defaultModel)?.label ??
                  "選択してください"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setDefaultModel(v);
                  writeDefaultModel(v || null);
                  void writeDefaultModelToServer(v || null).catch(
                    () => undefined,
                  );
                }}
                className="min-w-56 flex-1"
              >
                <option value="">選択してください</option>
                {[...new Set(modelOptions.map((o) => o.group))].map((group) => (
                  <optgroup key={group} label={group}>
                    {modelOptions
                      .filter((o) => o.group === group)
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </GhostSelect>
              {defaultModel && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="デフォルトをクリア"
                  onClick={() => {
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

      <section aria-labelledby="provider-models-heading">
        <h2
          id="provider-models-heading"
          className="mb-3 text-sm font-semibold text-muted"
        >
          プロバイダー/モデル
        </h2>
        <p className="mb-3 text-xs text-faint">
          利用可能な AI プロバイダーとモデルの表示を切り替えます。OpenCode
          設定ファイルは変更しません。
        </p>
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
                  onToggleModel={(model, enabled) =>
                    void toggle(`${provider.id}::${model.id}`, enabled)
                  }
                />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
