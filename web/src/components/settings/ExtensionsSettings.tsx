"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import type {
  McpDto,
  PluginDto,
  SkillDto,
} from "@/lib/extensions";
import type { HealthDto } from "@/lib/types";

type SectionStatus = "loading" | "ready" | "error";

function useExtensionSection<T extends { id: string }>(url: string, key: string) {
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await getJson<Record<string, T[]>>(url);
      const list = data[key];
      setItems(Array.isArray(list) ? list : []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      setStatus("error");
    }
  }, [url, key]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Toggle one item; returns success so the caller can request a restart. */
  const toggle = useCallback(
    async (item: T, patchUrl: string, enabled: boolean): Promise<boolean> => {
      setBusyId(item.id);
      setActionError(null);
      try {
        await sendJson("PATCH", patchUrl, { enabled });
        await load();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "操作に失敗しました");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return { status, items, error, busyId, actionError, load, toggle };
}

function useHostStatus() {
  const [hostOk, setHostOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await timedFetch("/api/host", { timeoutMs: 1500 });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (!cancelled) setHostOk(res.ok && Boolean(body.ok));
      } catch {
        if (!cancelled) setHostOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return hostOk;
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
        "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40",
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

function SectionShell({
  headingId,
  title,
  hint,
  status,
  error,
  actionError,
  onRetry,
  emptyText,
  itemCount,
  children,
}: {
  headingId: string;
  title: string;
  hint: string;
  status: SectionStatus;
  error: string | null;
  actionError: string | null;
  onRetry: () => void;
  emptyText: string;
  itemCount: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-sm font-semibold text-muted">
        {title}
      </h2>
      <p className="mb-3 text-xs text-faint">{hint}</p>
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
          <Button variant="secondary" size="sm" onClick={onRetry}>
            再試行
          </Button>
        </div>
      )}
      {status === "ready" &&
        (itemCount === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            {emptyText}
          </p>
        ) : (
          <ul className="space-y-2">{children}</ul>
        ))}
    </section>
  );
}

function mcpStatusBadge(server: McpDto): {
  text: string;
  tone: "neutral" | "working" | "success" | "warning" | "danger";
  pulse?: boolean;
} {
  if (!server.engineAvailable) return { text: "エンジン停止中", tone: "neutral" };
  if (server.pendingRestart) return { text: "再起動で反映", tone: "warning" };
  switch (server.runtime) {
    case "connected":
      return { text: "接続中", tone: "success" };
    case "failed":
      return { text: "接続失敗", tone: "danger" };
    case "needs_auth":
    case "needs_client_registration":
      return { text: "要認証", tone: "warning" };
    case "disabled":
      return { text: "無効", tone: "neutral" };
    default:
      return server.enabled
        ? { text: "接続中…", tone: "working", pulse: true }
        : { text: "無効", tone: "neutral" };
  }
}

export function ExtensionsSettings() {
  const skills = useExtensionSection<SkillDto>("/api/extensions/skills", "skills");
  const mcp = useExtensionSection<McpDto>("/api/extensions/mcp", "servers");
  const plugins = useExtensionSection<PluginDto>(
    "/api/extensions/plugins",
    "plugins",
  );
  const hostOk = useHostStatus();
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const loadSkills = skills.load;
  const loadMcp = mcp.load;
  const loadPlugins = plugins.load;
  const reloadAll = useCallback(async () => {
    await Promise.all([loadSkills(), loadMcp(), loadPlugins()]);
  }, [loadSkills, loadMcp, loadPlugins]);

  const restartOpencode = useCallback(async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      const res = await timedFetch("/api/host/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "opencode" }),
        timeoutMs: 10_000,
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
      let success = false;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const h = await getJson<HealthDto>("/api/health", undefined, {
            timeoutMs: 1500,
          });
          if (h.opencode?.ok === true) {
            success = true;
            break;
          }
        } catch {
          // still down
        }
      }
      if (!success) {
        throw new Error("OpenCode の再起動を確認できませんでした");
      }
      setRestartNeeded(false);
      await reloadAll();
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : "再起動に失敗しました");
    } finally {
      setRestarting(false);
    }
  }, [reloadAll]);

  const onToggled = (ok: boolean) => {
    if (ok) setRestartNeeded(true);
  };

  return (
    <div className="space-y-8">
      {restartNeeded && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3"
        >
          <p className="text-sm text-warning">
            変更を反映するには OpenCode の再起動が必要です。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              busy={restarting}
              disabled={hostOk !== true}
              onClick={() => void restartOpencode()}
            >
              OpenCode を再起動
            </Button>
            {hostOk !== true && (
              <span className="text-xs text-faint">
                トレイホスト（start-webui.bat）経由で再起動する必要があります。
              </span>
            )}
          </div>
          {restartError && (
            <p role="alert" className="text-xs text-danger">
              {restartError}
            </p>
          )}
        </div>
      )}

      <SectionShell
        headingId="extensions-skills"
        title="Skills"
        hint="グローバル設定（~/.config/opencode）のスキルを一覧しています。"
        status={skills.status}
        error={skills.error}
        actionError={skills.actionError}
        onRetry={() => void skills.load()}
        emptyText="スキルがありません。~/.config/opencode/skills/<名前>/SKILL.md を配置するとここに表示されます。"
        itemCount={skills.items.length}
      >
        {skills.items.map((s) => (
          <li
            key={s.id}
            aria-busy={skills.busyId === s.id || undefined}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{s.name}</p>
                <Badge tone={s.enabled ? "success" : "neutral"}>
                  {s.enabled ? "有効" : "無効"}
                </Badge>
                {!s.toggleable && <Badge tone="neutral">切替不可</Badge>}
              </div>
              {s.description && (
                <p className="mt-0.5 text-xs break-words text-faint">
                  {s.description}
                </p>
              )}
            </div>
            {s.toggleable && (
              <ExtensionSwitch
                name={s.name}
                enabled={s.enabled}
                busy={skills.busyId === s.id}
                onToggle={() =>
                  void skills
                    .toggle(
                      s,
                      `/api/extensions/skills/${encodeURIComponent(s.id)}`,
                      !s.enabled,
                    )
                    .then(onToggled)
                }
              />
            )}
          </li>
        ))}
      </SectionShell>

      <SectionShell
        headingId="extensions-mcp"
        title="MCP サーバー"
        hint="opencode.jsonc の mcp 設定を一覧しています。追加・編集・認証は引き続き CLI/Desktop で行ってください。"
        status={mcp.status}
        error={mcp.error}
        actionError={mcp.actionError}
        onRetry={() => void mcp.load()}
        emptyText={'MCP サーバーが設定されていません。~/.config/opencode/opencode.jsonc の "mcp" オブジェクトに追加してください。'}
        itemCount={mcp.items.length}
      >
        {mcp.items.map((server) => {
          const badge = mcpStatusBadge(server);
          return (
            <li
              key={server.id}
              aria-busy={mcp.busyId === server.id || undefined}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {server.name}
                  </p>
                  <Badge tone={badge.tone} pulse={badge.pulse}>
                    {badge.text}
                  </Badge>
                </div>
                {server.detail && (
                  <p className="mt-0.5 truncate font-mono text-xs text-faint">
                    {server.detail}
                  </p>
                )}
                {server.meta && (
                  <p className="truncate font-mono text-[11px] text-faint">
                    {server.meta}
                  </p>
                )}
              </div>
              <ExtensionSwitch
                name={server.name}
                enabled={server.enabled}
                busy={mcp.busyId === server.id}
                onToggle={() =>
                  void mcp
                    .toggle(
                      server,
                      `/api/extensions/mcp/${encodeURIComponent(server.id)}`,
                      !server.enabled,
                    )
                    .then(onToggled)
                }
              />
            </li>
          );
        })}
      </SectionShell>

      <SectionShell
        headingId="extensions-plugins"
        title="プラグイン"
        hint="設定済みプラグイン（opencode.jsonc）とローカル自動読込（plugin/*.js|ts）を一覧しています。"
        status={plugins.status}
        error={plugins.error}
        actionError={plugins.actionError}
        onRetry={() => void plugins.load()}
        emptyText="プラグインがありません。opencode.jsonc の plugin 配列、または ~/.config/opencode/plugin/ への .js/.ts 配置で追加できます。"
        itemCount={plugins.items.length}
      >
        {plugins.items.map((p) => (
          <li
            key={p.id}
            aria-busy={plugins.busyId === p.id || undefined}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-mono text-sm font-medium">
                  {p.name}
                </p>
                <Badge tone="neutral">
                  {p.kind === "config" ? "設定済み" : "ローカル自動読込"}
                </Badge>
                <Badge tone={p.enabled ? "success" : "neutral"}>
                  {p.enabled ? "有効" : "無効"}
                </Badge>
                {p.hasOptions && <Badge tone="neutral">オプション付き</Badge>}
                {p.managedByWebui && <Badge tone="warning">WebUI 管理</Badge>}
              </div>
              {p.managedByWebui && (
                <p className="mt-0.5 text-[11px] text-faint">
                  無効状態は WebUI のローカル管理情報です。opencode.jsonc
                  を手動で変更した場合は設定が優先されます。
                </p>
              )}
            </div>
            <ExtensionSwitch
              name={p.name}
              enabled={p.enabled}
              busy={plugins.busyId === p.id}
              onToggle={() =>
                void plugins
                  .toggle(
                    p,
                    `/api/extensions/plugins/${encodeURIComponent(p.id)}`,
                    !p.enabled,
                  )
                  .then(onToggled)
              }
            />
          </li>
        ))}
      </SectionShell>
    </div>
  );
}
