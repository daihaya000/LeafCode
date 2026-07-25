import fs from "node:fs";
import path from "node:path";
import { ocServer } from "@/lib/oc-server";
import { dataDir } from "@/lib/paths";
import type { AgentDto as BaseAgentDto } from "@/components/settings/agent-utils";
import { ExtensionsError } from "./safe-move";
import {
  applyEdits,
  modify,
  parseJsoncConfig,
  updateConfigFile,
  detectFormatting,
} from "./jsonc-edit";
import { opencodeConfigFilePath } from "./paths";

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

type AgentStateFile = {
  disabled?: string[];
};

function agentStatePath(): string {
  return path.join(dataDir(), "agent-state.json");
}

function readAgentState(): AgentStateFile {
  const filePath = agentStatePath();
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as AgentStateFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    return {};
  }
}

function writeAgentState(state: AgentStateFile): void {
  const filePath = agentStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function readConfigAgentMap(): Record<string, unknown> {
  try {
    const content = fs.readFileSync(opencodeConfigFilePath(), "utf8");
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

function agentEntryFromConfig(
  name: string,
  entry: unknown,
): AgentDto | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const e = entry as Record<string, unknown>;
  const disabled = e.disable === true;
  const description =
    typeof e.description === "string" ? e.description : undefined;
  const modeValue = e.mode;
  const mode: AgentDto["mode"] =
    modeValue === "subagent" || modeValue === "primary" || modeValue === "all"
      ? modeValue
      : "subagent";
  const modelValue = e.model;
  let model: AgentDto["model"];
  if (
    modelValue &&
    typeof modelValue === "object" &&
    !Array.isArray(modelValue)
  ) {
    const m = modelValue as Record<string, unknown>;
    const providerID =
      typeof m.providerID === "string" ? m.providerID : undefined;
    const modelID =
      typeof m.modelID === "string" ? m.modelID : undefined;
    if (providerID && modelID) {
      model = { providerID, modelID };
    }
  }
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

  for (const [name, entry] of Object.entries(agentsConfig)) {
    if (byName.has(name)) continue;
    const dto = agentEntryFromConfig(name, entry);
    if (dto && !dto.enabled) {
      byName.set(name, dto);
    }
  }

  const state = readAgentState();
  for (const name of state.disabled ?? []) {
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      mode: "subagent",
      enabled: false,
      toggleable: true,
    });
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function setAgentEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  if (!name || typeof name !== "string") {
    throw new ExtensionsError("not-found", "エージェント名が必要です");
  }

  let known = false;
  try {
    const upstream = await ocServer<AgentResponse>(null, "/agent");
    if (upstream.some((a) => a.name === name)) known = true;
  } catch {
    // Engine unavailable; rely on config/state.
  }
  if (!known) {
    const configAgents = readConfigAgentMap();
    if (configAgents[name] !== undefined) known = true;
  }
  if (!known) {
    const state = readAgentState();
    if (state.disabled?.includes(name)) known = true;
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
  const disabled = new Set(state.disabled ?? []);
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }
  const next = Array.from(disabled).sort();
  if (
    next.length !== (state.disabled ?? []).length ||
    next.some((n, i) => n !== (state.disabled ?? [])[i])
  ) {
    writeAgentState({ ...state, disabled: next });
  }
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
