"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import type {
  McpDto,
  PluginDto,
  SkillDto,
} from "@/lib/extensions";
import type { HealthDto } from "@/lib/types";

type SectionStatus = "loading" | "ready" | "error";

type SkillTreeNode = {
  kind: "skill" | "group";
  item?: SkillDto;
  name: string;
  children: SkillTreeNode[];
};

function buildSkillTree(items: SkillDto[]): SkillTreeNode[] {
  const map = new Map<string, SkillTreeNode>();
  for (const item of items) {
    const parts = item.id.split("/");
    if (parts.length === 1) {
      const existing = map.get(parts[0]);
      if (existing) {
        if (existing.kind === "group") {
          existing.kind = "skill";
          existing.item = item;
        }
      } else {
        map.set(parts[0], {
          kind: "skill",
          item,
          name: item.name,
          children: [],
        });
      }
    } else {
      const [first, ...rest] = parts;
      let parent = map.get(first);
      if (!parent) {
        parent = { kind: "group", name: first, children: [] };
        map.set(first, parent);
      }
      parent.children.push({
        kind: "skill",
        item,
        name: rest.join("/"),
        children: [],
      });
    }
  }
  const nodes = Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const node of nodes) {
    if (node.children.length > 0) {
      node.children.sort((a, b) => a.item!.id.localeCompare(b.item!.id));
    }
  }
  return nodes;
}

function SkillRow({
  item,
  depth,
  busy,
  onToggle,
}: {
  item: SkillDto;
  depth: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const displayName =
    depth > 0 ? (item.id.split("/").pop() ?? item.name) : item.name;
  return (
    <li
      aria-busy={busy || undefined}
      className={cx(
        "flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3",
        depth > 0 && "ml-4 border-l-2 border-l-border",
      )}
      title={depth > 0 ? item.id : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{displayName}</p>
          <Badge tone={item.enabled ? "success" : "neutral"}>
            {item.enabled ? "有効" : "無効"}
          </Badge>
          {!item.toggleable && <Badge tone="neutral">切替不可</Badge>}
        </div>
        {item.description && (
          <p className="mt-0.5 text-xs break-words text-faint">
            {item.description}
          </p>
        )}
      </div>
      {item.toggleable && (
        <ExtensionSwitch
          name={item.name}
          enabled={item.enabled}
          busy={busy}
          onToggle={onToggle}
        />
      )}
    </li>
  );
}

function SkillSubtree({
  node,
  busyId,
  onToggle,
}: {
  node: SkillTreeNode;
  busyId: string | null;
  onToggle: (item: SkillDto, enabled: boolean) => void;
}) {
  const isGroup = node.kind === "group";
  const item = node.item;
  const isBusy = !isGroup && item !== undefined && busyId === item.id;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    <li className="space-y-2" aria-busy={isBusy || undefined}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        {hasChildren && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${node.name} のサブスキルを${expanded ? "折りたたむ" : "展開"}`}
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              {isGroup ? node.name : item!.name}
            </p>
            {isGroup ? (
              <Badge tone="neutral">フォルダ</Badge>
            ) : (
              <>
                <Badge tone={item!.enabled ? "success" : "neutral"}>
                  {item!.enabled ? "有効" : "無効"}
                </Badge>
                {!item!.toggleable && <Badge tone="neutral">切替不可</Badge>}
              </>
            )}
          </div>
          {!isGroup && item!.description && (
            <p className="mt-0.5 text-xs break-words text-faint">
              {item!.description}
            </p>
          )}
        </div>
        {!isGroup && item!.toggleable && (
          <ExtensionSwitch
            name={item!.name}
            enabled={item!.enabled}
            busy={busyId === item!.id}
            onToggle={() => onToggle(item!, !item!.enabled)}
          />
        )}
      </div>
      {hasChildren && expanded && (
        <ul id={panelId} className="space-y-2">
          {node.children.map((child) => (
            <SkillRow
              key={child.item!.id}
              item={child.item!}
              depth={1}
              busy={busyId === child.item!.id}
              onToggle={() => {}}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function useExtensionSection<T extends { id: string }>(url: string, key: string) {
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const data = await getJson<Record<string, unknown>>(url);
      const list = data[key];
      setItems(Array.isArray(list) ? (list as T[]) : []);
      setTruncated(data.truncated === true);
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

  return { status, items, truncated, error, busyId, actionError, load, toggle };
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

function SectionShell({
  headingId,
  title,
  hint,
  notice,
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
  notice?: string;
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
      {notice && <p className="mb-3 text-xs text-warning">{notice}</p>}
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
            {hostOk === false && (
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
        notice={
          skills.truncated
            ? "スキル数が表示上限を超えたため、一部を一覧から省略しました。"
            : undefined
        }
        status={skills.status}
        error={skills.error}
        actionError={skills.actionError}
        onRetry={() => void skills.load()}
        emptyText="スキルがありません。~/.config/opencode/skills/<名前>/SKILL.md を配置するとここに表示されます。"
        itemCount={skills.items.length}
      >
        {buildSkillTree(skills.items).map((node) => (
          <SkillSubtree
            key={node.name}
            node={node}
            busyId={skills.busyId}
            onToggle={(item, enabled) =>
              void skills
                .toggle(
                  item,
                  `/api/extensions/skills/${encodeURIComponent(item.id)}`,
                  enabled,
                )
                .then(onToggled)
            }
          />
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
