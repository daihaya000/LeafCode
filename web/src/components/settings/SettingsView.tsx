"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Star, Trash2 } from "lucide-react";
import { AddProjectButton } from "@/components/AddProjectButton";
import { AgentsSettings } from "@/components/settings/AgentsSettings";
import { PluginSettings } from "@/components/plugins/PluginSettings";
import { Badge, Button, GhostSelect, cx, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import { copyText } from "@/lib/clipboard";
import {
  DEFAULT_USD_JPY_RATE,
  formatCost,
  readCostDisplayPrefs,
  writeCostDisplayPrefs,
  type CostCurrency,
  type CostDisplayPrefs,
} from "@/lib/currency";
import {
  readDefaultModel,
  writeDefaultModel,
} from "@/lib/default-model";
import {
  sortModelOptions,
  type ModelOption,
} from "@/lib/model-options";
import { providerIconSrcForOpencodeId } from "@/lib/plugins/codexbar";
import type { HealthDto, ProjectDto } from "@/lib/types";

type ProviderResponse = {
  all: { id: string; name: string; models: Record<string, { name?: string }> }[];
  connected: string[];
  default: Record<string, string>;
};

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

type OrphanDto = {
  id: string;
  displayName: string;
  absolutePath: string;
};

type StrayDto = { projectId: string; projectName: string; path: string };

type AccessInfo = {
  bind: string;
  port: number;
  localUrl: string;
  hint: string;
  addresses: {
    name: string;
    address: string;
    url: string;
    kind: "vpn" | "lan" | "other";
  }[];
};

type SettingsTab = "general" | "project" | "connectivity" | "plugins" | "agents";

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [hostOk, setHostOk] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState<"webui" | "opencode" | "all" | null>(
    null,
  );
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [orphans, setOrphans] = useState<OrphanDto[]>([]);
  const [stray, setStray] = useState<StrayDto[]>([]);
  const [newRoot, setNewRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mcpStatus, setMcpStatus] = useState<string>("未取得");
  const [costPrefs, setCostPrefs] = useState<CostDisplayPrefs>(() =>
    readCostDisplayPrefs(),
  );
  const [rateDraft, setRateDraft] = useState(() =>
    String(readCostDisplayPrefs().usdJpyRate),
  );
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");

  useEffect(() => {
    setDefaultModel(readDefaultModel() ?? "");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/opencode/provider", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ProviderResponse;
        const connected = new Set(data.connected ?? []);
        const options: ModelOption[] = [];
        for (const p of data.all ?? []) {
          if (connected.size > 0 && !connected.has(p.id)) continue;
          for (const [mid, m] of Object.entries(p.models ?? {})) {
            options.push({
              value: `${p.id}::${mid}`,
              label: m.name || mid,
              group: p.name || p.id,
            });
          }
        }
        setModelOptions(sortModelOptions(options));
        setDefaultModel((cur) => {
          if (cur && options.some((o) => o.value === cur)) return cur;
          return readDefaultModel() ?? "";
        });
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  useEffect(() => {
    const prefs = readCostDisplayPrefs();
    setCostPrefs(prefs);
    setRateDraft(String(prefs.usdJpyRate));
  }, []);

  const applyCostPrefs = (next: CostDisplayPrefs) => {
    setCostPrefs(next);
    setRateDraft(String(next.usdJpyRate));
    writeCostDisplayPrefs(next);
  };

  const setCurrency = (currency: CostCurrency) => {
    applyCostPrefs({ ...costPrefs, currency });
  };

  const commitRate = () => {
    const n = Number(rateDraft);
    const usdJpyRate = Number.isFinite(n) ? n : DEFAULT_USD_JPY_RATE;
    applyCostPrefs({ ...costPrefs, usdJpyRate });
  };

  const refresh = useCallback(async () => {
    const [h, p, r, o, a, m, host] = await Promise.allSettled([
      getJson<HealthDto>("/api/health"),
      getJson<{ projects: ProjectDto[] }>("/api/projects"),
      getJson<{ roots: string[] }>("/api/roots"),
      getJson<{ orphans: OrphanDto[]; stray: StrayDto[] }>(
        "/api/workspaces/orphans",
        { scan: "1" },
      ),
      getJson<AccessInfo>("/api/access"),
      fetch("/api/opencode/mcp", { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      }),
      fetch("/api/host", { cache: "no-store" }).then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        return { ok: res.ok && Boolean(body.ok) };
      }),
    ]);
    if (h.status === "fulfilled") setHealth(h.value);
    if (p.status === "fulfilled") setProjects(p.value.projects ?? []);
    if (r.status === "fulfilled") setRoots(r.value.roots ?? []);
    if (o.status === "fulfilled") {
      setOrphans(o.value.orphans ?? []);
      setStray(o.value.stray ?? []);
    }
    if (a.status === "fulfilled") setAccess(a.value);
    if (host.status === "fulfilled") setHostOk(host.value.ok);
    else setHostOk(false);
    if (m.status === "fulfilled") {
      const raw = m.value;
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { data?: unknown[] })?.data)
          ? (raw as { data: unknown[] }).data
          : raw && typeof raw === "object"
            ? Object.keys(raw as object)
            : [];
      setMcpStatus(
        list.length > 0
          ? `${list.length} 件（読取のみ・接続変更は CLI/Desktop）`
          : "MCP サーバーなし / 未接続",
      );
    } else {
      setMcpStatus("取得不可（エンジン未起動または未対応）");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restartService = async (target: "webui" | "opencode" | "all") => {
    const labels = {
      webui: "WebUI（フロントエンド）",
      opencode: "OpenCode（バックエンド）",
      all: "すべて",
    } as const;
    const ok = window.confirm(`${labels[target]}を再起動しますか？`);
    if (!ok) return;
    setRestarting(target);
    setError(null);
    try {
      const res = await fetch("/api/host/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok && res.status !== 202) {
        throw new Error(
          [data.error, data.hint].filter(Boolean).join(" — ") ||
            "再起動に失敗しました",
        );
      }
      if (target === "webui" || target === "all") {
        // WebUI process will die; poll until it comes back.
        for (let i = 0; i < 60; i += 1) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const h = await fetch("/api/health", { cache: "no-store" });
            if (h.ok) break;
          } catch {
            // still down
          }
        }
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "再起動に失敗しました");
    } finally {
      setRestarting(null);
    }
  };
  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
        notifyTasksChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "操作に失敗しました");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const toggleFavorite = (p: ProjectDto) =>
    guard(async () => {
      await sendJson("PATCH", "/api/projects", {
        id: p.id,
        favorite: !p.favorite,
      });
    });

  const removeProject = (p: ProjectDto) =>
    guard(async () => {
      const ok = window.confirm(
        `プロジェクト「${p.name}」を削除しますか？\n関連タスク / worktree も削除されます。`,
      );
      if (!ok) return;
      await sendJson("DELETE", "/api/projects", undefined, { id: p.id });
    });

  const addRoot = () =>
    guard(async () => {
      if (!newRoot.trim()) return;
      await sendJson("POST", "/api/roots", { path: newRoot.trim() });
      setNewRoot("");
    });

  const cleanupOrphans = () =>
    guard(async () => {
      const data = await sendJson<{
        results?: { ok: boolean; error?: string }[];
        strayErrors?: string[];
      }>("POST", "/api/workspaces/orphans", { action: "cleanup" });
      const failed = data.results?.filter((r) => !r.ok) ?? [];
      const strayErrors = data.strayErrors ?? [];
      if (failed.length > 0 || strayErrors.length > 0) {
        throw new Error(
          [...failed.map((f) => f.error), ...strayErrors].join("; "),
        );
      }
    });

  const copyUrl = async (url: string) => {
    const ok = await copyText(url);
    if (!ok) return;
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const kindLabel = (kind: string) =>
    kind === "vpn" ? "VPN" : kind === "lan" ? "LAN" : "その他";

  const requiresAttention = orphans.length + stray.length;
  const tabs: { key: SettingsTab; label: string; badge?: number }[] = [
    { key: "general", label: "全般" },
    {
      key: "project",
      label: "プロジェクト",
      badge: requiresAttention > 0 ? requiresAttention : undefined,
    },
    { key: "connectivity", label: "接続" },
    { key: "plugins", label: "プラグイン" },
    { key: "agents", label: "エージェント" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4">
          <div className="flex h-14 items-center">
            <h1 className="text-sm font-semibold">設定</h1>
          </div>
          <div className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cx(
                  "shrink-0 cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                  activeTab === t.key
                    ? "border-primary text-text"
                    : "border-transparent text-faint hover:text-muted",
                )}
              >
                {t.label}
                {Boolean(t.badge) && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/20 px-1 text-[10px] font-semibold text-warning">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 pb-[max(6rem,env(safe-area-inset-bottom))]">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {activeTab === "general" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">エンジン</h2>
              <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={health?.opencode.ok ? "success" : "danger"}>
                    {health?.opencode.ok ? "接続中" : "停止"}
                  </Badge>
                  <span className="text-sm text-muted">
                    OpenCode {health?.opencode.version ?? ""}
                  </span>
                  <Badge tone={hostOk ? "success" : "warning"}>
                    {hostOk ? "ホスト接続中" : "ホスト未検出"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    busy={restarting === "webui"}
                    disabled={hostOk !== true || restarting !== null}
                    onClick={() => void restartService("webui")}
                  >
                    WebUI を再起動
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    busy={restarting === "opencode"}
                    disabled={hostOk !== true || restarting !== null}
                    onClick={() => void restartService("opencode")}
                  >
                    OpenCode を再起動
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    busy={restarting === "all"}
                    disabled={hostOk !== true || restarting !== null}
                    onClick={() => void restartService("all")}
                  >
                    すべて再起動
                  </Button>
                </div>
                <p className="text-xs text-faint">
                  {hostOk
                    ? "トレイメニューの Restart WebUI / Restart OpenCode と同じ操作です。"
                    : "再起動には start-webui.bat（トレイホスト）経由の起動が必要です。"}
                </p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                デフォルトモデル
              </h2>
              <p className="mb-3 text-xs text-faint">
                新規タスク作成時の初期モデルです。各タスクで個別に上書きできます。
              </p>
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                {modelOptions.length === 0 ? (
                  <p className="text-sm text-faint">
                    利用可能なモデルがありません。エンジン接続を確認してください。
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
                      }}
                      className="min-w-56 flex-1"
                    >
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
                        }}
                      >
                        クリア
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">コスト表示</h2>
              <p className="mb-3 text-xs text-faint">
                OpenCode のコストは USD 基準です。日本円表示は設定レートでの換算です。
              </p>
              <div className="space-y-3 rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "USD" as const, label: "米ドル ($)" },
                      { value: "JPY" as const, label: "日本円 (¥)" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCurrency(opt.value)}
                      className={
                        costPrefs.currency === opt.value
                          ? "rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
                          : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="shrink-0 text-xs text-muted">USD/JPY レート</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={0.1}
                    value={rateDraft}
                    onChange={(e) => setRateDraft(e.target.value)}
                    onBlur={() => commitRate()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-9 w-full max-w-[10rem] rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none focus:border-border-strong"
                  />
                  <span className="text-[11px] text-faint">
                    例:{" "}
                    {formatCost(0.1542, {
                      currency: "JPY",
                      usdJpyRate: Number(rateDraft) || costPrefs.usdJpyRate,
                    })}
                  </span>
                </label>
              </div>
            </section>
          </>
        )}

        {activeTab === "project" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">プロジェクト</h2>
              <div className="mb-3">
                <AddProjectButton onAdded={() => void refresh()} />
              </div>
              <ul className="space-y-2">
                {projects.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate font-mono text-xs text-faint">
                        {p.rootPath}
                      </p>
                    </div>
                    {p.lastOpenedAt && (
                      <span className="hidden text-xs text-faint sm:inline">
                        {timeAgo(p.lastOpenedAt)}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      title="お気に入り"
                      onClick={() => void toggleFavorite(p)}
                      className="cursor-pointer rounded-lg p-2 text-faint hover:bg-surface-2"
                    >
                      <Star
                        className={
                          p.favorite
                            ? "h-4 w-4 fill-warning text-warning"
                            : "h-4 w-4"
                        }
                      />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title="プロジェクトを削除"
                      onClick={() => void removeProject(p)}
                      className="cursor-pointer rounded-lg p-2 text-faint hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {projects.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
                    プロジェクトがありません
                  </li>
                )}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                許可ルート（allowlist）
              </h2>
              <div className="mb-3 flex gap-2">
                <input
                  value={newRoot}
                  onChange={(e) => setNewRoot(e.target.value)}
                  placeholder="C:\path\to\allow"
                  className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addRoot();
                  }}
                />
                <Button busy={busy} onClick={() => void addRoot()}>
                  <Plus className="h-4 w-4" />
                  許可
                </Button>
              </div>
              <ul className="space-y-1">
                {roots.map((r) => (
                  <li
                    key={r}
                    className="truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-muted"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </section>

            {(orphans.length > 0 || stray.length > 0) && (
              <section>
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-warning">
                      要復旧の Workspace
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      worktree 削除に失敗した残骸です。フォルダが既に無いものは設定を開いたときに自動削除されます。
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    busy={busy}
                    disabled={orphans.length === 0 && stray.length === 0}
                    onClick={() => void cleanupOrphans()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    orphan を掃除
                  </Button>
                </div>
                <ul className="space-y-1 text-sm">
                  {orphans.map((o) => (
                    <li
                      key={o.id}
                      className="truncate rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning"
                    >
                      {o.displayName} · {o.absolutePath}
                    </li>
                  ))}
                  {stray.map((s) => (
                    <li
                      key={s.path}
                      className="truncate rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
                    >
                      stray ({s.projectName}): {s.path}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {activeTab === "connectivity" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                スマホ / VPN アクセス
              </h2>
              <p className="mb-3 text-xs text-faint">
                {access?.hint ??
                  "VPN 接続後、PC の VPN アドレス:3000 をスマホブラウザで開きます。"}
              </p>
              <ul className="space-y-2">
                {(access?.addresses ?? []).map((a) => (
                  <li
                    key={`${a.name}-${a.address}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-nowrap"
                  >
                    <Badge tone={a.kind === "vpn" ? "success" : "neutral"}>
                      {kindLabel(a.kind)}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">{a.url}</p>
                      <p className="truncate text-[11px] text-faint">{a.name}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="URL をコピー"
                      onClick={() => void copyUrl(a.url)}
                    >
                      {copied === a.url ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                ))}
                {access && access.addresses.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint">
                    利用可能なネットワークアドレスがありません
                  </li>
                )}
              </ul>
              <p className="mt-2 text-[11px] text-faint">
                同一ネットワークでも開けない場合は Windows ファイアウォールが原因です。
                管理者で{" "}
                <code className="rounded bg-surface-2 px-1">
                  scripts\allow-firewall-3000.bat
                </code>{" "}
                を実行するか、PowerShell（管理者）で:
                <br />
                <code className="mt-1 block break-all rounded bg-surface-2 px-1 py-0.5">
                  netsh advfirewall firewall add rule name=&quot;OpenCode WebUI&quot;
                  dir=in action=allow protocol=TCP localport=
                  {access?.port ?? 3000}
                </code>
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">MCP（読取）</h2>
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                {mcpStatus}
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">Remote Workspace</h2>
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                未実装（501）。VPN + ローカルパスで代替してください。
              </p>
            </section>
          </>
        )}

        {activeTab === "plugins" && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">プラグイン</h2>
            <p className="mb-3 text-xs text-faint">
              右下に表示するウィジェットの有効/無効を切り替えます。
            </p>
            <PluginSettings />
          </section>
        )}

        {activeTab === "agents" && <AgentsSettings />}
      </main>
    </div>
  );
}
