"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { BrowserBridgeApprovals } from "./BrowserBridgeApprovals";
import { BrowserBridgeSettings } from "./BrowserBridgeSettings";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import type { McpDto, PluginDto, SkillDto } from "@/lib/extensions";
import {
  skillDisplayLabel,
  skillHasJapaneseLabel,
} from "@/lib/skill-catalog-labels";
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
    item.title_ja ??
    (depth > 0
      ? skillDisplayLabel({
          ...item,
          name: item.id.split("/").pop() ?? item.name,
        })
      : skillDisplayLabel(item));
  const showOriginalName =
    item.title_ja
      ? item.title_ja !== item.name
      : skillHasJapaneseLabel(item) && displayName !== item.name;
  const description = item.description_ja ?? item.description;
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
          <p
            className="min-w-0 truncate text-sm font-medium text-accent"
            title={description || undefined}
          >
            {displayName}
          </p>
          <Badge tone={item.enabled ? "success" : "neutral"}>
            {item.enabled ? "有効" : "無効"}
          </Badge>
          {!item.toggleable && <Badge tone="neutral">切替不可</Badge>}
        </div>
        {showOriginalName && (
          <p className="mt-0.5 font-mono text-[11px] text-faint">{item.id}</p>
        )}
        {description && (
          <p className="mt-0.5 text-xs break-words text-faint">
            {description}
          </p>
        )}
      </div>
      {item.toggleable && (
        <ExtensionSwitch
          name={displayName}
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
  const displayName = isGroup
    ? node.name
    : (item!.title_ja ?? skillDisplayLabel(item!));
  const showOriginalName =
    !isGroup &&
    item !== undefined &&
    (item.title_ja
      ? item.title_ja !== item.name
      : skillHasJapaneseLabel(item) && displayName !== item.name);
  const description = !isGroup && item ? (item.description_ja ?? item.description) : undefined;
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
            <p
              className={cx(
                "min-w-0 truncate text-sm font-medium",
                isGroup ? "text-text" : "text-accent",
              )}
              title={!isGroup ? description || undefined : undefined}
            >
              {displayName}
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
          {showOriginalName && (
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              {item!.id}
            </p>
          )}
          {!isGroup && description && (
            <p className="mt-0.5 text-xs break-words text-faint">
              {description}
            </p>
          )}
        </div>
        {!isGroup && item!.toggleable && (
          <ExtensionSwitch
            name={displayName}
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
              onToggle={() => onToggle(child.item!, !child.item!.enabled)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function useExtensionSection<T extends { id: string }>(
  url: string,
  key: string,
) {
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const busyIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setStatus("loading");
    setError(null);
    try {
      const data = await getJson<Record<string, unknown>>(url);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      const list = data[key];
      setItems(Array.isArray(list) ? (list as T[]) : []);
      setTruncated(data.truncated === true);
      setStatus("ready");
    } catch (err) {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      setStatus("error");
    }
  }, [url, key]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [load]);

  /** Toggle one item; returns success so the caller can request a restart. */
  const toggle = useCallback(
    async (item: T, patchUrl: string, enabled: boolean): Promise<boolean> => {
      if (busyIdRef.current) return false;
      busyIdRef.current = item.id;
      setBusyId(item.id);
      setActionError(null);
      try {
        await sendJson("PATCH", patchUrl, { enabled });
        await load();
        return true;
      } catch (err) {
        if (mountedRef.current) setActionError(
          err instanceof Error ? err.message : "操作に失敗しました",
        );
        return false;
      } finally {
        if (busyIdRef.current === item.id) {
          busyIdRef.current = null;
          if (mountedRef.current) setBusyId(null);
        }
      }
    },
    [load],
  );

  const remove = useCallback(
    async (item: T, deleteUrl: string): Promise<boolean> => {
      if (busyIdRef.current) return false;
      busyIdRef.current = item.id;
      setBusyId(item.id);
      setActionError(null);
      try {
        await sendJson("DELETE", deleteUrl);
        await load();
        return true;
      } catch (err) {
        if (mountedRef.current) setActionError(
          err instanceof Error ? err.message : "削除に失敗しました",
        );
        return false;
      } finally {
        if (busyIdRef.current === item.id) {
          busyIdRef.current = null;
          if (mountedRef.current) setBusyId(null);
        }
      }
    },
    [load],
  );

  return { status, items, truncated, error, busyId, actionError, load, toggle, remove };
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
  if (!server.engineAvailable)
    return { text: "エンジン停止中", tone: "neutral" };
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

export type ExtensionSection = "skills" | "mcp" | "plugins";

export function ExtensionsSettings({
  activeSection,
}: {
  activeSection: ExtensionSection;
}) {
  const skills = useExtensionSection<SkillDto>(
    "/api/extensions/skills",
    "skills",
  );
  const mcp = useExtensionSection<McpDto>("/api/extensions/mcp", "servers");
  const plugins = useExtensionSection<PluginDto>(
    "/api/extensions/plugins",
    "plugins",
  );
  const hostOk = useHostStatus();
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const restartingRef = useRef(false);

  const [pluginFormOpen, setPluginFormOpen] = useState(false);
  const [pluginFormBusy, setPluginFormBusy] = useState(false);
  const pluginFormBusyRef = useRef(false);
  const [pluginFormMessage, setPluginFormMessage] = useState<string | null>(
    null,
  );
  const [pluginFormError, setPluginFormError] = useState<string | null>(null);
  const [editingPluginId, setEditingPluginId] = useState<string | null>(null);
  const [deleteConfirmPlugin, setDeleteConfirmPlugin] = useState<PluginDto | null>(null);
  const deleteConfirmRef = useRef<HTMLDivElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const [newPlugin, setNewPlugin] = useState<{
    name: string;
    optionsJson: string;
  }>({
    name: "",
    optionsJson: "",
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!deleteConfirmPlugin) {
      if (deleteTriggerRef.current?.isConnected) {
        deleteTriggerRef.current.focus();
      }
      deleteTriggerRef.current = null;
      return;
    }

    deleteConfirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDeleteConfirmPlugin(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmPlugin]);

  const loadSkills = skills.load;
  const loadMcp = mcp.load;
  const loadPlugins = plugins.load;
  const reloadAll = useCallback(async () => {
    await Promise.all([loadSkills(), loadMcp(), loadPlugins()]);
  }, [loadSkills, loadMcp, loadPlugins]);

  const restartOpencode = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
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
        if (!mountedRef.current) return;
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
        throw new Error("LeafCode の再起動を確認できませんでした");
      }
      if (mountedRef.current) setRestartNeeded(false);
      await reloadAll();
    } catch (err) {
      if (mountedRef.current) setRestartError(
        err instanceof Error ? err.message : "再起動に失敗しました",
      );
    } finally {
      restartingRef.current = false;
      if (mountedRef.current) setRestarting(false);
    }
  }, [reloadAll]);

  const onToggled = (ok: boolean) => {
    if (ok && mountedRef.current) setRestartNeeded(true);
  };

  const resetPluginForm = useCallback(() => {
    setEditingPluginId(null);
    setNewPlugin({ name: "", optionsJson: "" });
    setPluginFormError(null);
  }, []);

  const editPlugin = useCallback((p: PluginDto) => {
    setPluginFormOpen(true);
    setEditingPluginId(p.id);
    setPluginFormMessage(null);
    setPluginFormError(null);
    // Options are never sent to the client (they may hold credentials); a
    // blank field means "keep the existing value unchanged" on save.
    setNewPlugin({ name: p.name, optionsJson: "" });
  }, []);

  const savePlugin = useCallback(async () => {
    if (pluginFormBusyRef.current) return;
    const name = newPlugin.name.trim();
    const trimmedOptions = newPlugin.optionsJson.trim();
    let options: unknown;
    if (trimmedOptions) {
      try {
        options = JSON.parse(trimmedOptions);
      } catch {
        setPluginFormError("オプションはJSON形式で入力してください");
        return;
      }
    }
    pluginFormBusyRef.current = true;
    setPluginFormBusy(true);
    setPluginFormError(null);
    setPluginFormMessage(null);
    try {
      const body = { name, options };
      if (editingPluginId) {
        await sendJson(
          "PUT",
          `/api/extensions/plugins/${encodeURIComponent(editingPluginId)}`,
          body,
        );
      } else {
        await sendJson("POST", "/api/extensions/plugins", body);
      }
      if (!mountedRef.current) return;
      setPluginFormMessage(
        editingPluginId
          ? "更新しました。LeafCode の再起動後に反映されます。"
          : "登録しました。LeafCode の再起動後に利用できます。",
      );
      resetPluginForm();
      setRestartNeeded(true);
      await loadPlugins();
    } catch (err) {
      if (mountedRef.current) setPluginFormError(
        err instanceof Error ? err.message : "保存に失敗しました",
      );
    } finally {
      pluginFormBusyRef.current = false;
      if (mountedRef.current) setPluginFormBusy(false);
    }
  }, [editingPluginId, loadPlugins, newPlugin, resetPluginForm]);

  return (
    <div className="space-y-8">
      {restartNeeded && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3"
        >
          <p className="text-sm text-warning">
            変更を反映するには LeafCode の再起動が必要です。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              busy={restarting}
              disabled={hostOk !== true}
              onClick={() => void restartOpencode()}
            >
              LeafCode を再起動
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

      {activeSection === "mcp" && (
        <>
          <BrowserBridgeSettings />
          <BrowserBridgeApprovals />
        </>
      )}

      {activeSection === "skills" && (
        <SectionShell
          headingId="extensions-skills"
          title="スキル"
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
      )}

      {activeSection === "mcp" && (
        <SectionShell
          headingId="extensions-mcp"
          title="MCP サーバー"
          hint="opencode.jsonc の mcp 設定を一覧しています。追加・編集・認証は引き続き CLI/Desktop で行ってください。"
          status={mcp.status}
          error={mcp.error}
          actionError={mcp.actionError}
          onRetry={() => void mcp.load()}
          emptyText={
            'MCP サーバーが設定されていません。~/.config/opencode/opencode.jsonc の "mcp" オブジェクトに追加してください。'
          }
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
      )}

      {activeSection === "plugins" && (
        <>
          <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-muted">
                  {editingPluginId ? "プラグイン編集" : "新規プラグイン登録"}
                </h3>
                <p className="mt-1 text-xs text-faint">
                  {editingPluginId
                    ? "オプションは機密情報を含む可能性があるため表示されません。空欄のままにすると既存の値を維持します。"
                    : "opencode.jsonc の plugin 配列に npm パッケージ名を追加します。オプション（JSON）は任意です。"}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (pluginFormOpen) resetPluginForm();
                  setPluginFormOpen((v) => !v);
                }}
              >
                {pluginFormOpen ? "閉じる" : "登録"}
              </Button>
            </div>
            {pluginFormOpen && (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-xs text-faint">
                  プラグイン名 / npm指定
                  <input
                    value={newPlugin.name}
                    onChange={(e) =>
                      setNewPlugin((v) => ({ ...v, name: e.target.value }))
                    }
                    placeholder="opencode-my-plugin@latest"
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-primary"
                  />
                </label>
                <label className="grid gap-1 text-xs text-faint">
                  オプション（JSON、任意
                  {editingPluginId ? "・空欄で既存値を維持" : ""}）
                  <textarea
                    value={newPlugin.optionsJson}
                    onChange={(e) =>
                      setNewPlugin((v) => ({
                        ...v,
                        optionsJson: e.target.value,
                      }))
                    }
                    placeholder={'{ "apiKey": "..." }'}
                    rows={3}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-muted outline-none focus:border-primary"
                  />
                </label>
                {pluginFormError && (
                  <p role="alert" className="text-xs text-danger">
                    {pluginFormError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={pluginFormBusy}
                    onClick={() => void savePlugin()}
                  >
                    {pluginFormBusy
                      ? "保存中…"
                      : editingPluginId
                        ? "設定を保存"
                        : "プラグインを登録"}
                  </Button>
                  {editingPluginId && (
                    <Button variant="ghost" size="sm" onClick={resetPluginForm}>
                      新規登録に戻す
                    </Button>
                  )}
                  {pluginFormMessage && (
                    <p className="text-xs text-success">{pluginFormMessage}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          {deleteConfirmPlugin && (
            <div
              ref={deleteConfirmRef}
              role="alertdialog"
              aria-label="プラグイン削除の確認"
              aria-describedby="plugin-delete-confirm-description"
              className="mb-4 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
            >
              <p id="plugin-delete-confirm-description">
                プラグイン「{deleteConfirmPlugin.name}」を一覧から削除しますか？
                <br />
                WebUI管理の保存状態とオプションが失われ、後から有効化しても復元できません。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  busy={plugins.busyId === deleteConfirmPlugin.id}
                  onClick={() => {
                    const plugin = deleteConfirmPlugin;
                    deleteTriggerRef.current = null;
                    setDeleteConfirmPlugin(null);
                    void plugins.remove(
                      plugin,
                      `/api/extensions/plugins/${encodeURIComponent(plugin.id)}`,
                    );
                  }}
                >
                  削除する
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmPlugin(null)}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          )}
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
            {plugins.items.map((p) => {
              const editable = p.kind === "config" && !p.managedByWebui;
              return (
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
                      {p.hasOptions && (
                        <Badge tone="neutral">オプション付き</Badge>
                      )}
                      {p.managedByWebui && (
                        <Badge tone="warning">WebUI 管理</Badge>
                      )}
                    </div>
                    {p.description && (
                      <p className="mt-0.5 text-xs break-words text-faint">
                        {p.description}
                      </p>
                    )}
                    {p.managedByWebui && (
                      <p className="mt-0.5 text-[11px] text-faint">
                        無効状態と元設定は WebUI のローカル管理情報です。状態を一覧から削除すると元設定（オプションを含む）は失われ、再有効化しても復元できません。
                      </p>
                    )}
                  </div>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editPlugin(p)}
                    >
                      編集
                    </Button>
                  )}
                  {p.managedByWebui && !p.enabled && (
                    <Button
                      variant="danger"
                      size="sm"
                      busy={plugins.busyId === p.id}
                      onClick={() => {
                        deleteTriggerRef.current =
                          document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                        setDeleteConfirmPlugin(p);
                      }}
                    >
                      一覧から削除
                    </Button>
                  )}
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
              );
            })}
          </SectionShell>
        </>
      )}
    </div>
  );
}
