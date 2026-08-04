import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ocServer } from "@/lib/oc-server";
import { dataDir } from "@/lib/paths";
import type {
  AgentDto as BaseAgentDto,
  AgentScope,
} from "@/components/settings/agent-utils";
import { ExtensionsError } from "./safe-move";
import {
  applyEdits,
  modify,
  parseJsoncConfig,
  updateConfigFile,
  detectFormatting,
} from "./jsonc-edit";
import {
  agentDefinitionDirs,
  configDirStateKey,
  opencodeConfigFilePath,
  projectAgentDefinitionDirs,
  projectConfigFilePath,
  projectRoot,
} from "./paths";

export type AgentDto = BaseAgentDto & {
  enabled: boolean;
  toggleable: boolean;
};

export type AgentListResponse = {
  agents: AgentDto[];
};

type AgentResponse = {
  name: string;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  model?: { providerID?: string; modelID?: string };
}[];

/**
 * Metadata remembered for a disabled agent.
 *
 * A disabled agent disappears from the engine's `/agent` response, so without
 * a snapshot the listing would only know its name — and the settings table
 * derives Rank/role from `name` + `model` (see agent-utils.parseAgent). We
 * therefore capture the engine metadata at disable time and replay it while
 * the agent stays disabled.
 */
type AgentSnapshot = {
  description?: string;
  mode?: AgentDto["mode"];
  model?: { providerID: string; modelID: string };
};

type AgentStateFile = {
  /** name → metadata snapshot captured when the agent was disabled. */
  disabled?: Record<string, AgentSnapshot>;
};

/**
 * Per-config-directory WebUI state file for disabled-agent bookkeeping.
 *
 * Deliberately not the old flat `dataDir()/agent-state.json`: that single
 * file was shared across every OpenCode config profile, so switching
 * profiles could resurrect another profile's disabled-agent entries as
 * ghost rows (agents that don't exist in the now-active profile at all).
 * `configDirStateKey()` (see `./paths`) keys the file per resolved config
 * directory instead. No migration from the old path is performed —
 * starting empty for a profile that has never been seen is the safe
 * default; the config file's own `agent.<name>.disable` flags and
 * definition files remain the source of truth for anything that matters
 * functionally.
 */
export function agentStatePath(): string {
  return path.join(dataDir(), "agent-state", `${configDirStateKey()}.json`);
}

function normalizeSnapshot(value: unknown): AgentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const snapshot: AgentSnapshot = {};
  if (typeof v.description === "string") snapshot.description = v.description;
  if (v.mode === "subagent" || v.mode === "primary" || v.mode === "all") {
    snapshot.mode = v.mode;
  }
  const model = parseModelValue(v.model);
  if (model) snapshot.model = model;
  return snapshot;
}

function readAgentState(): AgentStateFile {
  const filePath = agentStatePath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    // Missing or corrupted state means "nothing remembered", which is safe.
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const raw = (parsed as { disabled?: unknown }).disabled;
  const disabled: Record<string, AgentSnapshot> = {};
  if (Array.isArray(raw)) {
    // Legacy shape: plain array of names, no metadata.
    for (const name of raw) {
      if (typeof name === "string" && name) disabled[name] = {};
    }
  } else if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!name) continue;
      disabled[name] = normalizeSnapshot(value);
    }
  }
  return { disabled };
}

function writeAgentState(state: AgentStateFile): void {
  const filePath = agentStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Accept both engine/state shape (`{ providerID, modelID }`) and the
 * OpenCode config shape (`"provider/model-id"`).
 */
function parseModelValue(
  value: unknown,
): { providerID: string; modelID: string } | undefined {
  if (typeof value === "string") {
    const slash = value.indexOf("/");
    if (slash > 0 && slash < value.length - 1) {
      return {
        providerID: value.slice(0, slash),
        modelID: value.slice(slash + 1),
      };
    }
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const m = value as Record<string, unknown>;
  const providerID = typeof m.providerID === "string" ? m.providerID : undefined;
  const modelID = typeof m.modelID === "string" ? m.modelID : undefined;
  return providerID && modelID ? { providerID, modelID } : undefined;
}

function readConfigAgentMap(): Record<string, unknown> {
  return readConfigAgentMapAt(opencodeConfigFilePath());
}

/** Same as `readConfigAgentMap()` but for an arbitrary (or missing) config path. */
function readConfigAgentMapAt(
  configPath: string | null,
): Record<string, unknown> {
  if (!configPath) return {};
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const root = parseJsoncConfig(content);
    const agents = root.agent;
    if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
      return {};
    }
    return agents as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Rewrite an absolute path under the user's home dir as `~/...` for display,
 * else return it with forward slashes for a consistent cross-platform look
 * (relevant when `OPENCODE_CONFIG_DIR` points somewhere outside the home dir).
 */
function homeRelative(absPath: string): string {
  const normalized = absPath.split(path.sep).join("/");
  const home = os.homedir();
  if (!home) return normalized;
  const homeNormalized = home.split(path.sep).join("/");
  if (normalized === homeNormalized || normalized.startsWith(`${homeNormalized}/`)) {
    return `~${normalized.slice(homeNormalized.length)}`;
  }
  return normalized;
}

/** Rewrite an absolute path under the project root as a relative display path. */
function projectRelative(absPath: string): string {
  const rel = path.relative(projectRoot(), absPath);
  return rel.split(path.sep).join("/");
}

/**
 * Resolve where an agent is defined: this project's `.opencode/agents/` or
 * `opencode.jsonc`, the global equivalents under `~/.config/opencode`, or
 * neither (a built-in agent shipped with OpenCode itself).
 *
 * Project sources take precedence over global ones, matching OpenCode's own
 * config precedence (see https://opencode.ai/docs/config#locations). Paths
 * are shortened for display (`~/...` / relative to the project root) rather
 * than shown as full machine-specific absolute paths.
 */
function resolveAgentSource(
  name: string,
  projectConfigAgents: Record<string, unknown>,
  globalConfigAgents: Record<string, unknown>,
): { scope: AgentScope; sourcePath: string | null } {
  if (projectConfigAgents[name] !== undefined) {
    const configPath = projectConfigFilePath();
    return {
      scope: "project",
      sourcePath: configPath ? projectRelative(configPath) : null,
    };
  }
  const projectMd = findDefinitionFile(projectAgentDefinitionDirs(), name);
  if (projectMd) {
    return { scope: "project", sourcePath: projectRelative(projectMd) };
  }

  if (globalConfigAgents[name] !== undefined) {
    return {
      scope: "global",
      sourcePath: homeRelative(opencodeConfigFilePath()),
    };
  }
  const globalMd = findDefinitionFile(agentDefinitionDirs(), name);
  if (globalMd) {
    return { scope: "global", sourcePath: homeRelative(globalMd) };
  }

  return { scope: "builtin", sourcePath: null };
}

/** First `<name>.md` found across `dirs`, or `null` when none exist. */
function findDefinitionFile(dirs: string[], name: string): string | null {
  if (!SAFE_AGENT_NAME.test(name)) return null;
  for (const dir of dirs) {
    const file = path.join(dir, `${name}.md`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** True when a config `agent.<name>` entry sets `disable: true`. */
function isConfigDisabled(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  return (entry as Record<string, unknown>).disable === true;
}

/**
 * Build a listing entry for an agent that only exists in `opencode.jsonc`.
 * `snapshot` fills the gaps the config override does not carry (a disabled
 * built-in usually only has `disable: true`), so Rank/role/model stay visible.
 */
function agentEntryFromConfig(
  name: string,
  entry: unknown,
  snapshot: AgentSnapshot | undefined,
): AgentDto | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const e = entry as Record<string, unknown>;
  const disabled = e.disable === true;
  const description =
    typeof e.description === "string" ? e.description : snapshot?.description;
  const modeValue = e.mode;
  const mode: AgentDto["mode"] =
    modeValue === "subagent" || modeValue === "primary" || modeValue === "all"
      ? modeValue
      : (snapshot?.mode ?? "subagent");
  const model = parseModelValue(e.model) ?? snapshot?.model;
  return {
    name,
    description,
    mode,
    model,
    enabled: !disabled,
    toggleable: true,
  };
}

export async function listAgents(): Promise<AgentDto[]> {
  const active: AgentDto[] = [];
  try {
    const upstream = await ocServer<AgentResponse>(null, "/agent");
    for (const item of upstream) {
      if (!item.name) continue;
      active.push({
        name: item.name,
        description: item.description,
        mode: item.mode ?? "subagent",
        model:
          item.model?.providerID && item.model?.modelID
            ? {
                providerID: item.model.providerID,
                modelID: item.model.modelID,
              }
            : undefined,
        enabled: true,
        toggleable: true,
      });
    }
  } catch (err) {
    if (err instanceof Error) {
      throw new ExtensionsError(
        "config",
        `エージェント一覧の取得に失敗しました: ${err.message}`,
      );
    }
    throw err;
  }

  const byName = new Map(active.map((a) => [a.name, a]));
  const agentsConfig = readConfigAgentMap();
  const projectAgentsConfig = readConfigAgentMapAt(projectConfigFilePath());
  const state = readAgentState();
  const snapshots = state.disabled ?? {};

  // Precedence for a disabled agent's metadata: explicit config override, then
  // the snapshot taken at disable time, then its definition file.
  const recall = (name: string): AgentSnapshot =>
    mergeSnapshots(snapshots[name], snapshotFromDefinition(name));

  for (const [name, entry] of Object.entries(agentsConfig)) {
    const existing = byName.get(name);
    if (existing) {
      // The engine hasn't restarted yet, so it still reports this agent as
      // active — but the config's `disable` flag is what the user just set
      // and is what will take effect on restart. Reflect that intent now,
      // otherwise a toggle looks like it did nothing until restart.
      if (isConfigDisabled(entry)) {
        byName.set(name, { ...existing, enabled: false });
      }
      continue;
    }
    const dto = agentEntryFromConfig(name, entry, recall(name));
    if (dto && !dto.enabled) {
      byName.set(name, dto);
    }
  }

  for (const name of Object.keys(snapshots)) {
    if (byName.has(name)) continue;
    const snapshot = recall(name);
    byName.set(name, {
      name,
      description: snapshot.description,
      mode: snapshot.mode ?? "subagent",
      model: snapshot.model,
      enabled: false,
      toggleable: true,
    });
  }

  return Array.from(byName.values())
    .map((agent) => ({
      ...agent,
      ...resolveAgentSource(agent.name, projectAgentsConfig, agentsConfig),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setAgentEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  if (!name || typeof name !== "string") {
    throw new ExtensionsError("not-found", "エージェント名が必要です");
  }

  let known = false;
  let liveEntry: AgentResponse[number] | undefined;
  try {
    const upstream = await ocServer<AgentResponse>(null, "/agent");
    liveEntry = upstream.find((a) => a.name === name);
    if (liveEntry) known = true;
  } catch {
    // Engine unavailable; rely on config/state.
  }
  if (!known) {
    const configAgents = readConfigAgentMap();
    if (configAgents[name] !== undefined) known = true;
  }
  if (!known) {
    const state = readAgentState();
    if (state.disabled?.[name] !== undefined) known = true;
  }
  if (!known) {
    throw new ExtensionsError(
      "not-found",
      "指定のエージェントが見つかりません",
    );
  }

  await updateConfigFile(opencodeConfigFilePath(), (content) =>
    updateAgentDisable(content, name, !enabled),
  );

  const state = readAgentState();
  const disabled = { ...(state.disabled ?? {}) };
  if (enabled) {
    delete disabled[name];
  } else {
    // Remember the metadata now: once disabled the engine stops reporting the
    // agent, and the settings table needs `model` to resolve Rank/role.
    disabled[name] = mergeSnapshots(
      snapshotFromLive(liveEntry),
      disabled[name],
      snapshotFromConfig(name),
      snapshotFromDefinition(name),
    );
  }
  const sorted: Record<string, AgentSnapshot> = {};
  for (const key of Object.keys(disabled).sort()) {
    sorted[key] = disabled[key];
  }
  writeAgentState({ ...state, disabled: sorted });
}

/**
 * Enable/disable every toggleable agent that resolves to `providerID`.
 * Idempotent: agents already in the target state are skipped. Returns the
 * number of agents whose state actually changed.
 *
 * ponytail: sequential per-agent config rewrites are fine for the handful of
 * agents per provider; batch the opencode.jsonc rewrite only if a single
 * provider grows past ~50 agents.
 */
export async function setProviderEnabled(
  providerID: string,
  enabled: boolean,
): Promise<number> {
  if (!providerID || typeof providerID !== "string") {
    throw new ExtensionsError("not-found", "提供元の指定が必要です");
  }
  const agents = await listAgents();
  const targets = agents.filter(
    (a) =>
      a.toggleable &&
      a.model?.providerID === providerID &&
      a.enabled !== enabled,
  );
  for (const agent of targets) {
    await setAgentEnabled(agent.name, enabled);
  }
  return targets.length;
}

function snapshotFromLive(
  entry: AgentResponse[number] | undefined,
): AgentSnapshot | undefined {
  if (!entry) return undefined;
  return normalizeSnapshot({
    description: entry.description,
    mode: entry.mode,
    model: entry.model,
  });
}

function snapshotFromConfig(name: string): AgentSnapshot {
  const entry = readConfigAgentMap()[name];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  return normalizeSnapshot(entry as Record<string, unknown>);
}

/** Agent names are used to build file paths, so keep them to a safe charset. */
const SAFE_AGENT_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Read `description` / `mode` / `model` from an agent definition markdown's
 * frontmatter. This is the recovery path for agents that were disabled before
 * snapshots existed (or whose state file was cleared): the engine no longer
 * reports them, but their definition file still carries the metadata the
 * settings table needs to resolve Rank/role.
 *
 * Deliberately minimal — the three keys are single-line scalars in agent files.
 */
function snapshotFromDefinition(name: string): AgentSnapshot | undefined {
  if (!SAFE_AGENT_NAME.test(name)) return undefined;
  for (const dir of agentDefinitionDirs()) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, `${name}.md`), "utf8");
    } catch {
      continue;
    }
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!block) continue;
    const found: Record<string, string> = {};
    for (const line of block[1].split(/\r?\n/)) {
      const kv = /^(description|mode|model)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      const value = kv[2].trim().replace(/^["']|["']$/g, "").trim();
      if (value && found[kv[1]] === undefined) found[kv[1]] = value;
    }
    const snapshot = normalizeSnapshot(found);
    if (snapshot.description || snapshot.mode || snapshot.model) {
      return snapshot;
    }
  }
  return undefined;
}

/** Merge snapshots by preferring the earlier (higher-precedence) source. */
function mergeSnapshots(
  ...sources: (AgentSnapshot | undefined)[]
): AgentSnapshot {
  const merged: AgentSnapshot = {};
  for (const source of sources) {
    if (!source) continue;
    merged.description ??= source.description;
    merged.mode ??= source.mode;
    merged.model ??= source.model;
  }
  return merged;
}

function updateAgentDisable(
  content: string,
  name: string,
  disable: boolean,
): string {
  const root = parseJsoncConfig(content);
  const agents = root.agent;
  const hasAgentKey =
    agents !== undefined && typeof agents === "object" && !Array.isArray(agents);

  const formattingOptions = detectFormatting(content);

  if (!hasAgentKey) {
    const edits = modify(content, ["agent", name, "disable"], disable, {
      formattingOptions,
    });
    return applyEdits(content, edits);
  }

  const entry = (agents as Record<string, unknown>)[name];
  if (entry === undefined) {
    const edits = modify(content, ["agent", name, "disable"], disable, {
      formattingOptions,
    });
    return applyEdits(content, edits);
  }

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ExtensionsError("config", "agent 設定が不正です");
  }

  const current = (entry as Record<string, unknown>).disable;
  if (current === true && disable) return content;
  if (current === false && !disable) return content;
  if (current === undefined && !disable) return content;

  const edits = modify(content, ["agent", name, "disable"], disable, {
    formattingOptions,
  });
  return applyEdits(content, edits);
}
