"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "@/components/ui";
import {
  filterAgents,
  groupAgents,
  parseAgent,
  type AgentDto,
  type AgentGroup,
  type ParsedAgent,
} from "./agent-utils";

type LoadState = "loading" | "ready" | "error";

function modeTone(mode: ParsedAgent["mode"]): "working" | "neutral" {
  return mode === "primary" ? "working" : "neutral";
}

function ModelLabel({ agent }: { agent: ParsedAgent }) {
  if (!agent.model) return <span className="text-faint">未設定</span>;
  return (
    <span className="font-mono text-xs text-muted">
      {agent.model.providerID} / {agent.model.modelID}
    </span>
  );
}

function AgentGroupTable({ group }: { group: AgentGroup }) {
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
            <tr className="border-b border-border text-xs text-faint">
              <th scope="col" className="w-24 px-4 py-2 font-medium">
                Rank
              </th>
              <th scope="col" className="w-1/4 px-4 py-2 font-medium">
                エージェント
              </th>
              <th scope="col" className="w-1/4 px-4 py-2 font-medium">
                モデル
              </th>
              <th scope="col" className="w-24 px-4 py-2 font-medium">
                Mode
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                説明
              </th>
            </tr>
          </thead>
          <tbody>
            {group.agents.map((agent) => (
              <tr
                key={agent.name}
                className="border-b border-border last:border-0 align-top"
              >
                <td className="px-4 py-2.5">
                  {agent.rank ? (
                    <Badge tone="neutral">Rank {agent.rank}</Badge>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="truncate font-medium text-text">
                    {agent.displayName}
                  </div>
                  {agent.role && (
                    <div className="truncate font-mono text-xs text-muted">
                      {agent.name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <ModelLabel agent={agent} />
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={modeTone(agent.mode)}>{agent.mode}</Badge>
                </td>
                <td className="truncate px-4 py-2.5 text-muted">
                  {agent.description || (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: row cards */}
      <ul className="space-y-2 sm:hidden">
        {group.agents.map((agent) => (
          <li
            key={agent.name}
            className="rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {agent.rank && <Badge tone="neutral">Rank {agent.rank}</Badge>}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {agent.displayName}
              </span>
              <Badge tone={modeTone(agent.mode)}>{agent.mode}</Badge>
            </div>
            {agent.role && (
              <p className="mt-1 truncate font-mono text-xs text-faint">
                {agent.name}
              </p>
            )}
            <p className="mt-1 text-xs">
              <ModelLabel agent={agent} />
            </p>
            {agent.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {agent.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentsSettings() {
  const [state, setState] = useState<LoadState>("loading");
  const [agents, setAgents] = useState<ParsedAgent[]>([]);
  const [query, setQuery] = useState("");

  const load = useMemo(
    () => async () => {
      setState("loading");
      try {
        const res = await fetch("/api/opencode/agent", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as AgentDto[];
        const list = Array.isArray(data) ? data : [];
        setAgents(list.map(parseAgent));
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [],
  );

  useEffect(() => {
    void load();
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
        <p>
          エージェントを取得できませんでした。OpenCode
          サーバーが起動しているか確認してください。
        </p>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          再試行
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">{agents.length} 件のエージェント</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="エージェントを検索"
          placeholder="名前・役割・モデルで検索"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong sm:max-w-xs"
        />
      </div>

      {agents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-faint">
          表示できるエージェントがありません。
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-faint">
          「{query}」に一致するエージェントはありません。
        </p>
      ) : (
        groups.map((group) => (
          <AgentGroupTable key={group.key} group={group} />
        ))
      )}
    </div>
  );
}
