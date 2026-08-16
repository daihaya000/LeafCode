"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { IntelligenceSelect } from "@/components/IntelligenceSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { AgentSwitch } from "@/components/settings/AgentSwitch";
import { Badge, Button, cx } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import {
  parseAgentFrontmatter,
  setAgentScalar,
} from "@/lib/agent-frontmatter";
import { ALL_INTELLIGENCE_VARIANTS } from "@/lib/model-variants";
import {
  ensureModelOption,
  useProviderModels,
} from "@/lib/useProviderModels";
import type { HealthDto } from "@/lib/types";
import {
  filterAgents,
  groupAgents,
  parseAgent,
  scopeLabel,
  type AgentDto,
  type AgentGroup,
  type AgentScope,
  type ParsedAgent,
} from "@/lib/agent-utils";

type LoadState = "loading" | "ready" | "error";

/** Editable global definition file (`~/.config/opencode/agents/<name>.md`). */
type AgentFileDto = {
  name: string;
  displayPath: string;
  exists: boolean;
  content: string;
  enabled: boolean;
};

type AgentRowModel = ParsedAgent & {
  /** Effective state: disabled by either the config or the definition file. */
  enabled: boolean;
  /** State coming from `opencode.jsonc` alone, needed to re-enable both. */
  configEnabled: boolean;
  toggleable: boolean;
  /** Present only for agents backed by an editable global markdown file. */
  file?: AgentFileDto;
};

const DEFAULT_AGENT_TEMPLATE = `---
description: ""
mode: subagent
---
`;

function modeTone(mode: ParsedAgent["mode"]): "working" | "neutral" {
  return mode === "primary" ? "working" : "neutral";
}

function scopeTone(scope: AgentScope | undefined): "working" | "neutral" {
  return scope === "project" ? "working" : "neutral";
}

/**
 * Merge the engine/config listing with the editable global definition files.
 *
 * Both directions matter: an agent can exist only in the config (built-ins,
 * `agent.<name>` entries) and an agent can exist only as a file the engine no
 * longer reports (because its frontmatter disables it). Showing just one source
 * would make rows disappear exactly when the user wants to re-enable them.
 */
function mergeAgents(
  agents: AgentDto[],
  files: AgentFileDto[],
): AgentRowModel[] {
  const fileByName = new Map(files.map((file) => [file.name, file]));
  const byName = new Map<string, AgentDto>();
  for (const agent of agents) byName.set(agent.name, agent);
  for (const file of files) {
    if (byName.has(file.name)) continue;
    const fm = parseAgentFrontmatter(file.content);
    byName.set(file.name, {
      name: file.name,
      description: fm.description,
      mode: fm.mode ?? "subagent",
      model: fm.model,
      enabled: !fm.disabled,
      toggleable: true,
      scope: "global",
      sourcePath: file.displayPath,
    });
  }
  return Array.from(byName.values())
    .map((dto) => {
      const file = fileByName.get(dto.name);
      const configEnabled = dto.enabled ?? true;
      return {
        ...parseAgent(dto),
        enabled: configEnabled && (file ? file.enabled : true),
        configEnabled,
        toggleable: dto.toggleable ?? true,
        file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ModelLabel({ agent }: { agent: ParsedAgent }) {
  if (!agent.model) return <span className="text-muted">未設定</span>;
  return (
    <span className="min-w-0 break-words font-mono text-xs text-muted">
      {agent.model.providerID} / {agent.model.modelID}
    </span>
  );
}

/** One selectable row of the left pane: name, state switch, delete. */
function AgentListRow({
  row,
  active,
  busy,
  onSelect,
  onToggle,
  onDelete,
}: {
  row: AgentRowModel;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
        active ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-2",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <Users
          className={cx(
            "h-3.5 w-3.5 shrink-0",
            row.enabled ? "text-muted" : "text-faint",
          )}
        />
        <span className="min-w-0">
          <span
            className={cx(
              "block truncate text-sm font-medium",
              row.enabled ? "text-text" : "text-faint",
            )}
          >
            {row.displayName}
          </span>
          {/* Built-ins have no file; their group heading already says so. */}
          {row.sourcePath && (
            <span className="block truncate font-mono text-[10px] text-faint">
              {row.sourcePath}
            </span>
          )}
        </span>
      </button>
      {row.toggleable && (
        <AgentSwitch
          name={row.name}
          enabled={row.enabled}
          busy={busy}
          onToggle={onToggle}
        />
      )}
      {row.file && (
        <button
          type="button"
          aria-label={`エージェント「${row.name}」を削除`}
          title="削除"
          disabled={busy}
          onClick={onDelete}
          className="shrink-0 rounded-lg p-1.5 text-faint hover:bg-danger-bg hover:text-danger disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
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
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [files, setFiles] = useState<AgentFileDto[]>([]);
  const [query, setQuery] = useState("");
  const [activeName, setActiveName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const hostOk = useHostStatus();
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const busyNameRef = useRef<string | null>(null);
  const busyProviderRef = useRef<string | null>(null);
  const restartingRef = useRef(false);
  /** Content the editor was seeded with, to detect unsaved edits on reload. */
  const baselineRef = useRef("");
  /** Mirrors `activeName` so reloads can re-seed the editor without re-running. */
  const activeNameRef = useRef<string | null>(null);
  /**
   * Unsaved model/variant overrides for agents without a definition file
   * (built-ins and config-defined agents). `null` = nothing edited yet.
   */
  const [configDraft, setConfigDraft] = useState<{
    model: string;
    variant: string;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  const load = useMemo(
    () =>
      async ({ retry = false }: { retry?: boolean } = {}) => {
        const requestId = ++loadRequestRef.current;
        if (retry) {
          setRetrying(true);
        } else {
          setState("loading");
        }
        try {
          const data = await getJson<{ agents: AgentDto[] }>(
            "/api/extensions/agents",
          );
          if (!mountedRef.current || requestId !== loadRequestRef.current) return;
          setAgents(Array.isArray(data.agents) ? data.agents : []);
          setState("ready");
        } catch {
          if (!mountedRef.current || requestId !== loadRequestRef.current) return;
          setState("error");
        } finally {
          if (mountedRef.current && retry && requestId === loadRequestRef.current) {
            setRetrying(false);
          }
        }
      },
    [],
  );

  /**
   * Definition files load independently of the agent listing: the listing is
   * what the tab needs to render at all, while the files only add the editor
   * and the delete affordance. Blocking one on the other would hide the whole
   * tab whenever the config directory is unreadable.
   */
  const loadFiles = useCallback(async () => {
    try {
      const data = await getJson<{ files: AgentFileDto[] }>(
        "/api/extensions/agent-files",
      );
      if (!mountedRef.current) return;
      const list = Array.isArray(data.files) ? data.files : [];
      setFiles(list);
      setDraft((current) => {
        if (current !== baselineRef.current) return current; // keep unsaved edits
        const active = list.find((file) => file.name === activeNameRef.current);
        baselineRef.current = active?.content ?? "";
        return baselineRef.current;
      });
    } catch {
      if (mountedRef.current) setFiles([]);
    }
  }, []);

  useEffect(() => {
    activeNameRef.current = activeName;
  }, [activeName]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const reload = useCallback(async () => {
    await load();
    await loadFiles();
  }, [load, loadFiles]);

  const selectAgent = useCallback(
    (row: AgentRowModel) => {
      setActiveName(row.name);
      baselineRef.current = row.file?.content ?? "";
      setDraft(baselineRef.current);
      setConfigDraft(
        row.file
          ? null
          : {
              model: row.model
                ? `${row.model.providerID}::${row.model.modelID}`
                : "",
              variant: row.variant ?? "",
            },
      );
      setActionError(null);
      setMessage(null);
    },
    [],
  );

  const toggleAgent = useCallback(
    async (agent: AgentRowModel, enabled: boolean) => {
      if (
        busyNameRef.current !== null ||
        busyProviderRef.current !== null ||
        restartingRef.current
      ) {
        return;
      }
      busyNameRef.current = agent.name;
      setBusyName(agent.name);
      setActionError(null);
      setMessage(null);
      const filePath = `/api/extensions/agent-files/${encodeURIComponent(agent.name)}`;
      const configPath = `/api/extensions/agents/${encodeURIComponent(agent.name)}`;
      try {
        if (enabled) {
          // Either source can be holding the agent down, so clear both.
          if (agent.file && !agent.file.enabled) {
            await sendJson("PATCH", filePath, { enabled: true });
          }
          if (!agent.configEnabled) {
            await sendJson("PATCH", configPath, { enabled: true });
          }
        } else if (agent.file) {
          // The definition file is the agent's own source of truth; writing the
          // flag there keeps it with the file instead of leaving an orphaned
          // `agent.<name>.disable` entry behind after a delete.
          await sendJson("PATCH", filePath, { enabled: false });
        } else {
          await sendJson("PATCH", configPath, { enabled: false });
        }
        await reload();
        if (mountedRef.current) setRestartNeeded(true);
      } catch (err) {
        if (mountedRef.current) {
          setActionError(
            err instanceof Error ? err.message : "操作に失敗しました",
          );
        }
      } finally {
        busyNameRef.current = null;
        if (mountedRef.current) setBusyName(null);
      }
    },
    [reload],
  );

  const toggleProvider = useCallback(
    async (providerID: string, enabled: boolean) => {
      if (
        busyNameRef.current !== null ||
        busyProviderRef.current !== null ||
        restartingRef.current
      ) {
        return;
      }
      busyProviderRef.current = providerID;
      setBusyProvider(providerID);
      setActionError(null);
      setMessage(null);
      try {
        await sendJson("PATCH", "/api/extensions/agents/by-provider", {
          providerID,
          enabled,
        });
        await reload();
        if (mountedRef.current) setRestartNeeded(true);
      } catch (err) {
        if (mountedRef.current) {
          setActionError(
            err instanceof Error ? err.message : "操作に失敗しました",
          );
        }
      } finally {
        busyProviderRef.current = null;
        if (mountedRef.current) setBusyProvider(null);
      }
    },
    [reload],
  );

  const createAgent = useCallback(async () => {
    const name = newAgentName.trim();
    if (creating || !name) return;
    setCreating(true);
    setActionError(null);
    setMessage(null);
    try {
      await sendJson("POST", "/api/extensions/agent-files", {
        name,
        content: DEFAULT_AGENT_TEMPLATE,
      });
      setNewAgentName("");
      setActiveName(name);
      activeNameRef.current = name;
      baselineRef.current = DEFAULT_AGENT_TEMPLATE;
      setDraft(DEFAULT_AGENT_TEMPLATE);
      await reload();
      if (mountedRef.current) {
        setRestartNeeded(true);
        setMessage(`エージェント「${name}」を作成しました`);
      }
    } catch (err) {
      if (mountedRef.current) {
        setActionError(
          err instanceof Error ? err.message : "エージェントの作成に失敗しました",
        );
      }
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }, [creating, newAgentName, reload]);

  const saveAgentFile = useCallback(
    async (name: string) => {
      if (savingFile) return;
      setSavingFile(true);
      setActionError(null);
      setMessage(null);
      try {
        await sendJson(
          "PUT",
          `/api/extensions/agent-files/${encodeURIComponent(name)}`,
          { content: draft },
        );
        baselineRef.current = draft;
        await reload();
        if (mountedRef.current) {
          setRestartNeeded(true);
          setMessage(`エージェント「${name}」を保存しました`);
        }
      } catch (err) {
        if (mountedRef.current) {
          setActionError(
            err instanceof Error ? err.message : "エージェントの保存に失敗しました",
          );
        }
      } finally {
        if (mountedRef.current) setSavingFile(false);
      }
    },
    [draft, reload, savingFile],
  );

  /**
   * Save model/effort overrides for an agent without a definition file
   * (built-ins and config-defined agents) into `agent.<name>` of the
   * opencode.jsonc. `model`/`variant` empty means "clear the override".
   */
  const saveAgentConfig = useCallback(
    async (name: string) => {
      if (savingConfig || !configDraft) return;
      setSavingConfig(true);
      setActionError(null);
      setMessage(null);
      try {
        await sendJson(
          "PATCH",
          `/api/extensions/agents/${encodeURIComponent(name)}`,
          {
            model: configDraft.model
              ? configDraft.model.split("::").join("/")
              : null,
            variant: configDraft.variant || null,
          },
        );
        await reload();
        if (mountedRef.current) {
          setRestartNeeded(true);
          setMessage(`エージェント「${name}」のモデル設定を保存しました`);
        }
      } catch (err) {
        if (mountedRef.current) {
          setActionError(
            err instanceof Error ? err.message : "モデル設定の保存に失敗しました",
          );
        }
      } finally {
        if (mountedRef.current) setSavingConfig(false);
      }
    },
    [configDraft, reload, savingConfig],
  );

  const deleteAgentFile = useCallback(
    async (name: string) => {
      if (busyNameRef.current !== null) return;
      busyNameRef.current = name;
      setBusyName(name);
      setActionError(null);
      setMessage(null);
      try {
        await sendJson(
          "DELETE",
          `/api/extensions/agent-files/${encodeURIComponent(name)}`,
        );
        if (activeNameRef.current === name) {
          setActiveName(null);
          activeNameRef.current = null;
          baselineRef.current = "";
          setDraft("");
        }
        await reload();
        if (mountedRef.current) {
          setRestartNeeded(true);
          setMessage(`エージェント「${name}」を削除しました`);
        }
      } catch (err) {
        if (mountedRef.current) {
          setActionError(
            err instanceof Error ? err.message : "エージェントの削除に失敗しました",
          );
        }
      } finally {
        busyNameRef.current = null;
        if (mountedRef.current) setBusyName(null);
      }
    },
    [reload],
  );

  const restartOpencode = useCallback(async () => {
    if (
      restartingRef.current ||
      busyNameRef.current !== null ||
      busyProviderRef.current !== null
    ) {
      return;
    }
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
        throw new Error("OpenCode の再起動を確認できませんでした");
      }
      if (mountedRef.current) setRestartNeeded(false);
      await reload();
    } catch (err) {
      if (mountedRef.current) {
        setRestartError(
          err instanceof Error ? err.message : "再起動に失敗しました",
        );
      }
    } finally {
      restartingRef.current = false;
      if (mountedRef.current) setRestarting(false);
    }
  }, [reload]);

  const rows = useMemo(() => mergeAgents(agents, files), [agents, files]);
  const filtered = useMemo(() => filterAgents(rows, query), [rows, query]);
  const groups = useMemo(() => groupAgents(filtered), [filtered]);
  const selected = useMemo(
    () => rows.find((row) => row.name === activeName) ?? null,
    [rows, activeName],
  );
  const providerModels = useProviderModels();
  // Draft-based so the model/effort dropdowns track unsaved textarea edits
  // (e.g. typing a different `model:` line) immediately.
  const selectedFrontmatter = useMemo(
    () => parseAgentFrontmatter(draft),
    [draft],
  );
  const selectedModelValue = useMemo(() => {
    const model = selectedFrontmatter.model;
    return model ? `${model.providerID}::${model.modelID}` : "";
  }, [selectedFrontmatter.model]);
  const selectedModelOptions = useMemo(
    () => ensureModelOption(providerModels.modelOptions, selectedModelValue),
    [providerModels.modelOptions, selectedModelValue],
  );
  const selectedVariantOptions = useMemo(() => {
    if (!selectedFrontmatter.model) return ALL_INTELLIGENCE_VARIANTS;
    return (
      providerModels.variantsMap[selectedModelValue] ??
      ALL_INTELLIGENCE_VARIANTS
    );
  }, [providerModels.variantsMap, selectedModelValue, selectedFrontmatter.model]);
  const selectedVariant = selectedFrontmatter.variant ?? "";
  const switchesBusy = busyName !== null || busyProvider !== null;

  // Model/effort dropdowns for agents without a definition file (built-ins).
  const configModelOptions = useMemo(
    () =>
      ensureModelOption(providerModels.modelOptions, configDraft?.model ?? ""),
    [providerModels.modelOptions, configDraft?.model],
  );
  const configVariantOptions = useMemo(() => {
    if (!configDraft?.model) return ALL_INTELLIGENCE_VARIANTS;
    return (
      providerModels.variantsMap[configDraft.model] ?? ALL_INTELLIGENCE_VARIANTS
    );
  }, [providerModels.variantsMap, configDraft?.model]);

  const providerGroups = useMemo(() => {
    const counts = new Map<string, { total: number; enabledCount: number }>();
    for (const agent of rows) {
      const providerID = agent.model?.providerID;
      if (!providerID || !agent.toggleable) continue;
      const entry = counts.get(providerID) ?? { total: 0, enabledCount: 0 };
      entry.total += 1;
      if (agent.enabled) entry.enabledCount += 1;
      counts.set(providerID, entry);
    }
    return Array.from(counts.entries())
      .map(([providerID, c]) => ({
        providerID,
        ...c,
        allEnabled: c.enabledCount === c.total,
      }))
      .sort((a, b) => a.providerID.localeCompare(b.providerID));
  }, [rows]);

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
              disabled={hostOk !== true || busyName !== null}
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

      {providerGroups.length > 0 && (
        <section
          aria-labelledby="agents-provider-heading"
          className="rounded-xl border border-border bg-surface p-4"
        >
          <h2
            id="agents-provider-heading"
            className="mb-3 text-sm font-semibold text-muted"
          >
            提供元ごとの一括操作
          </h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {providerGroups.map((group) => (
              <li
                key={group.providerID}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">
                    {group.providerID}
                  </div>
                  <div className="text-xs text-muted">
                    {group.enabledCount}/{group.total} 有効
                  </div>
                </div>
                <AgentSwitch
                  name={`${group.providerID} の全エージェント`}
                  enabled={group.allEnabled}
                  busy={switchesBusy}
                  onToggle={() =>
                    void toggleProvider(group.providerID, !group.allEnabled)
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted">{rows.length} 件のエージェント</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="エージェントを検索"
          placeholder="名前・役割・提供元・モデル・説明・Mode・状態で検索"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:max-w-xs"
        />
      </div>

      {actionError && (
        <p role="alert" className="text-xs text-danger">{actionError}</p>
      )}
      {message && (
        <p role="status" className="text-xs text-success">{message}</p>
      )}

      <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="エージェント一覧" className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
              aria-label="新規エージェント名"
              placeholder="新しいエージェント名"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAgent();
              }}
            />
            <button
              type="button"
              aria-label="エージェントを作成"
              title="エージェントを作成"
              disabled={creating || !newAgentName.trim()}
              onClick={() => void createAgent()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              表示できるエージェントがありません。
            </p>
          ) : groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              「{query}」に一致するエージェントはありません。
            </p>
          ) : (
            groups.map((group: AgentGroup) => (
              <section
                key={group.key}
                aria-labelledby={`agents-group-${group.key}`}
                className="space-y-1"
              >
                <h2
                  id={`agents-group-${group.key}`}
                  className="px-1 text-xs font-semibold text-muted"
                >
                  {group.title}
                </h2>
                {group.agents.map((agent) => {
                  const row = agent as AgentRowModel;
                  return (
                    <AgentListRow
                      key={row.name}
                      row={row}
                      active={row.name === activeName}
                      busy={switchesBusy}
                      onSelect={() => selectAgent(row)}
                      onToggle={() => void toggleAgent(row, !row.enabled)}
                      onDelete={() => void deleteAgentFile(row.name)}
                    />
                  );
                })}
              </section>
            ))
          )}
        </nav>

        <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
          {selected ? (
            <>
              <div className="mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-mono text-sm font-semibold text-text">
                    {selected.name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={selected.enabled ? "success" : "neutral"}>
                      {selected.enabled ? "有効" : "無効"}
                    </Badge>
                    <Badge tone={modeTone(selected.mode)}>{selected.mode}</Badge>
                    <Badge tone={scopeTone(selected.scope)}>
                      {scopeLabel(selected.scope)}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-faint">
                  {selected.sourcePath ?? "ビルトイン（ファイルなし）"}
                </p>
                <p className="mt-1">
                  {selected.file ? (
                    <span className="min-w-0 break-words font-mono text-xs text-muted">
                      {selectedFrontmatter.model
                        ? `${selectedFrontmatter.model.providerID} / ${selectedFrontmatter.model.modelID}`
                        : "未設定"}
                    </span>
                  ) : (
                    <ModelLabel agent={selected} />
                  )}
                </p>
                {selected.variant && (
                  <p className="mt-1 font-mono text-xs text-muted">
                    effort: {selected.variant}
                  </p>
                )}
                {selected.description && (
                  <p className="mt-1 text-xs text-muted">{selected.description}</p>
                )}
              </div>

              {selected.file ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-xs font-medium text-muted">モデル</span>
                    <ModelSelect
                      value={selectedModelValue}
                      options={selectedModelOptions}
                      disabled={savingFile || switchesBusy}
                      emptyLabel="未設定"
                      ariaLabel="モデル"
                      onChange={(value) =>
                        setDraft(
                          setAgentScalar(
                            draft,
                            "model",
                            value ? value.split("::").join("/") : "",
                          ),
                        )
                      }
                    />
                    <span className="text-xs font-medium text-muted">
                      推論 effort
                    </span>
                    <IntelligenceSelect
                      variants={selectedVariantOptions}
                      value={selectedVariant}
                      disabled={
                        savingFile || switchesBusy || !selectedFrontmatter.model
                      }
                      onChange={(value) =>
                        setDraft(setAgentScalar(draft, "variant", value))
                      }
                    />
                    {!selectedFrontmatter.model && (
                      <span className="text-[11px] text-faint">
                        モデルが未設定のため effort は適用されません
                      </span>
                    )}
                    {selectedVariant && (
                      <span className="text-[11px] text-faint">
                        保存時に frontmatter へ variant: {selectedVariant} を書き込みます
                      </span>
                    )}
                  </div>
                  <textarea
                    aria-label={`エージェント「${selected.name}」の内容`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    className="min-h-[28rem] w-full resize-y rounded-lg border border-border bg-bg px-3 py-3 font-mono text-xs leading-5 text-text outline-none focus:border-primary"
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      busy={savingFile}
                      onClick={() => void saveAgentFile(selected.name)}
                    >
                      エージェントを保存
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-xs font-medium text-muted">モデル</span>
                    <ModelSelect
                      value={configDraft?.model ?? ""}
                      options={configModelOptions}
                      disabled={savingConfig || switchesBusy}
                      emptyLabel="未設定（既定に従う）"
                      ariaLabel="モデル"
                      onChange={(value) =>
                        setConfigDraft((d) => ({
                          model: value,
                          variant: d?.variant ?? "",
                        }))
                      }
                    />
                    <span className="text-xs font-medium text-muted">
                      推論 effort
                    </span>
                    <IntelligenceSelect
                      variants={configVariantOptions}
                      value={configDraft?.variant ?? ""}
                      disabled={
                        savingConfig || switchesBusy || !configDraft?.model
                      }
                      onChange={(value) =>
                        setConfigDraft((d) => ({
                          model: d?.model ?? "",
                          variant: value,
                        }))
                      }
                    />
                    {!configDraft?.model && (
                      <span className="text-[11px] text-faint">
                        モデルが未設定のため effort は適用されません
                      </span>
                    )}
                  </div>
                  <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
                    このエージェントは
                    {selected.scope === "project"
                      ? "プロジェクト側"
                      : selected.scope === "global"
                        ? "opencode.jsonc"
                        : "OpenCode 本体"}
                    で定義されています。モデルと effort は{" "}
                    <code>agent.{selected.name}</code> として opencode.jsonc
                    に書き込まれ、再起動後に反映されます。解除すると
                    OpenCode の既定に戻ります。
                  </p>
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      busy={savingConfig}
                      onClick={() => void saveAgentConfig(selected.name)}
                    >
                      モデル設定を保存
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="py-12 text-center text-sm text-faint">
              左の一覧からエージェントを選択するか、「+」で新しいエージェントを作成してください
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
