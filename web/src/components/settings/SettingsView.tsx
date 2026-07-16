"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Star, Trash2 } from "lucide-react";
import { AddProjectButton } from "@/components/AddProjectButton";
import { Badge, Button, timeAgo } from "@/components/ui";
import { notifyTasksChanged } from "@/lib/events";
import { getJson, sendJson } from "@/lib/client";
import type { HealthDto, ProjectDto } from "@/lib/types";

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

export function SettingsView() {
  const [health, setHealth] = useState<HealthDto | null>(null);
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

  const refresh = useCallback(async () => {
    const [h, p, r, o, a, m] = await Promise.allSettled([
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
    ]);
    if (h.status === "fulfilled") setHealth(h.value);
    if (p.status === "fulfilled") setProjects(p.value.projects ?? []);
    if (r.status === "fulfilled") setRoots(r.value.roots ?? []);
    if (o.status === "fulfilled") {
      setOrphans(o.value.orphans ?? []);
      setStray(o.value.stray ?? []);
    }
    if (a.status === "fulfilled") setAccess(a.value);
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
      const data = await sendJson<{ results?: { ok: boolean; error?: string }[] }>(
        "POST",
        "/api/workspaces/orphans",
        { action: "cleanup" },
      );
      const failed = data.results?.filter((r) => !r.ok) ?? [];
      if (failed.length > 0) {
        throw new Error(failed.map((f) => f.error).join("; "));
      }
    });

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const kindLabel = (kind: string) =>
    kind === "vpn" ? "VPN" : kind === "lan" ? "LAN" : "その他";

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <h1 className="text-sm font-semibold">設定</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 pb-24">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted">エンジン</h2>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <Badge tone={health?.opencode.ok ? "success" : "danger"}>
              {health?.opencode.ok ? "接続中" : "停止"}
            </Badge>
            <span className="text-sm text-muted">
              OpenCode {health?.opencode.version ?? ""}
            </span>
            <span className="flex-1" />
            {!health?.opencode.ok && (
              <span className="text-xs text-faint">
                トレイの「再起動」で復旧してください
              </span>
            )}
          </div>
        </section>

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
                className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
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

        {(orphans.length > 0 || stray.length > 0) && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
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
                disabled={orphans.length === 0}
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
      </main>
    </div>
  );
}
