"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import type { HealthDto } from "@/lib/types";
import {
  filterAgents,
  groupAgents,
  parseAgent,
  type AgentDto,
  type AgentGroup,
  type ParsedAgent,
} from "./agent-utils";

type LoadState = "loading" | "ready" | "error";

type AgentRowModel = ParsedAgent & {
  enabled: boolean;
  toggleable: boolean;
};

function modeTone(mode: ParsedAgent["mode"]): "working" | "neutral" {
  return mode === "primary" ? "working" : "neutral";
}

function enabledTone(enabled: boolean): "success" | "neutral" {
  return enabled ? "success" : "neutral";
}

function ModelLabel({ agent }: { agent: ParsedAgent }) {
  if (!agent.model) return <span className="text-muted">未設定</span>;
  return (
    <span className="min-w-0 break-words font-mono text-xs text-muted">
      {agent.model.providerID} / {agent.model.modelID}
    </span>
  );
}

function AgentSwitch({
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

function AgentGroupTable({
  group,
  busyName,
  actionError,
  onToggle,
}: {
  group: AgentGroup;
  busyName: string | null;
  actionError: string | null;
  onToggle: (agent: AgentRowModel, enabled: boolean) => void;
}) {
  const headingId = `agents-group-${group.key}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-sm font-semibold text-muted">
        {group.title}
      </h2>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface sm:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th scope="col" className="w-24 px-4 py-2 font-medium">
                Rank
              </th>
              <th scope="col" className="w-1/4 px-4 py-2 font-medium">
                エージェント
              </th>
              <th scope="col" className="w-1/5 px-4 py-2 font-medium">
                モデル
              </th>
              <th scope="col" className="w-24 px-4 py-2 font-medium">
                Mode
              </th>
              {/* Wide enough for badge + 44px switch: a narrower cell makes the
                  switch spill into the 説明 column under table-fixed. */}
              <th scope="col" className="w-36 px-4 py-2 font-medium">
                状態
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                説明
              </th>
            </tr>
          </thead>
          <tbody>
            {group.agents.map((agent) => {
              const row = agent as AgentRowModel;
              const busy = busyName === row.name;
              return (
                <tr
                  key={row.name}
                  aria-busy={busy || undefined}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className="px-4 py-2.5">
                    {row.rank ? (
                      <Badge tone="neutral">Rank {row.rank}</Badge>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="truncate font-medium text-text">
                      {row.displayName}
                    </div>
                    {row.role && (
                      <div className="truncate font-mono text-xs text-muted">
                        {row.name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ModelLabel agent={row} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={modeTone(row.mode)}>{row.mode}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Badge tone={enabledTone(row.enabled)}>
                        {row.enabled ? "有効" : "無効"}
                      </Badge>
                      {row.toggleable && (
                        <AgentSwitch
                          name={row.name}
                          enabled={row.enabled}
                          busy={busy}
                          onToggle={() => onToggle(row, !row.enabled)}
                        />
                      )}
                    </div>
                  </td>
                  <td className="truncate px-4 py-2.5 text-muted">
                    {row.description || (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: row cards */}
      <ul className="space-y-2 sm:hidden">
        {group.agents.map((agent) => {
          const row = agent as AgentRowModel;
          const busy = busyName === row.name;
          return (
            <li
              key={row.name}
              aria-busy={busy || undefined}
              className="rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                {row.rank && <Badge tone="neutral">Rank {row.rank}</Badge>}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  {row.displayName}
                </span>
                <Badge tone={modeTone(row.mode)}>{row.mode}</Badge>
              </div>
              {row.role && (
                <p className="mt-1 truncate font-mono text-xs text-muted">
                  {row.name}
                </p>
              )}
              <p className="mt-1 text-xs">
                <ModelLabel agent={row} />
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={enabledTone(row.enabled)}>
                    {row.enabled ? "有効" : "無効"}
                  </Badge>
                  {actionError && busy && (
                    <span className="text-xs text-danger">{actionError}</span>
                  )}
                </div>
                {row.toggleable && (
                  <AgentSwitch
                    name={row.name}
                    enabled={row.enabled}
                    busy={busy}
                    onToggle={() => onToggle(row, !row.enabled)}
                  />
                )}
              </div>
              {row.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted">
                  {row.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
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

export function AgentsSettings() {
  const [state, setState] = useState<LoadState>("loading");
  const [agents, setAgents] = useState<AgentRowModel[]>([]);
  const [query, setQuery] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const hostOk = useHostStatus();

  const load = useMemo(
    () =>
    async ({ retry = false }: { retry?: boolean } = {}) => {
      if (retry) {
        setRetrying(true);
      } else {
        setState("loading");
      }
      try {
        const data = await getJson<{ agents: AgentDto[] }>("/api/extensions/agents");
        const list = Array.isArray(data.agents) ? data.agents : [];
        setAgents(
          list.map((dto) => ({
            ...parseAgent(dto),
            enabled: dto.enabled ?? true,
            toggleable: dto.toggleable ?? true,
          })),
        );
        setState("ready");
      } catch {
        setState("error");
      } finally {
        if (retry) setRetrying(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAgent = useCallback(
    async (agent: AgentRowModel, enabled: boolean) => {
      setBusyName(agent.name);
      setActionError(null);
      try {
        await sendJson(
          "PATCH",
          `/api/extensions/agents/${encodeURIComponent(agent.name)}`,
          { enabled },
        );
        await load();
        setRestartNeeded(true);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "操作に失敗しました",
        );
      } finally {
        setBusyName(null);
      }
    },
    [load],
  );

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
      await load();
    } catch (err) {
      setRestartError(
        err instanceof Error ? err.message : "再起動に失敗しました",
      );
    } finally {
      setRestarting(false);
    }
  }, [load]);

  const filtered = useMemo(
    () => filterAgents(agents, query),
    [agents, query],
  );
  const groups = useMemo(() => groupAgents(filtered), [filtered]);

  if (state === "loading") {
    return (
      <p
        aria-busy="true"
        className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted"
      >
        エージェントを読み込んでいます…
      </p>
    );
  }

  if (state === "error") {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-4 text-sm text-danger"
      >
        <p className="text-muted">
          エージェントを取得できませんでした。OpenCode
          サーバーが起動しているか確認してください。
        </p>
        {actionError && (
          <p role="alert" className="text-xs text-danger">{actionError}</p>
        )}
        <Button
          variant="secondary"
          size="sm"
          busy={retrying}
          onClick={() => void load({ retry: true })}
          className="focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          再試行
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            <p role="alert" className="text-xs text-danger">{restartError}</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">{agents.length} 件のエージェント</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="エージェントを検索"
          placeholder="名前・役割・提供元・モデル・説明・Mode・状態で検索"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary sm:max-w-xs"
        />
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-danger">{actionError}</p>
      )}

      {agents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          表示できるエージェントがありません。
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          「{query}」に一致するエージェントはありません。
        </p>
      ) : (
        groups.map((group) => (
          <AgentGroupTable
            key={group.key}
            group={group}
            busyName={busyName}
            actionError={actionError}
            onToggle={toggleAgent}
          />
        ))
      )}
    </div>
  );
}
