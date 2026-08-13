import { useMemo, useState } from "react";
import { AUTO_MODEL_VALUE } from "@/lib/auto-model";
import { readAutoTaskRecord } from "@/lib/auto-task-record";
import { type ModelOption } from "@/lib/model-options";
import {
  type IntelligenceVariant,
  type ProviderModelMeta,
} from "@/lib/model-variants";

/**
 * TaskView のモデル/エージェント選択 state（REFACTORING_PLAN 5-b /
 * IMPROVEMENT 1-1）。HomeView の同型 state と共通化する候補。
 * プロバイダ/エージェント取得（fetch）は TaskView 側に残す。
 */
export function useTaskModelConfig(taskId: string) {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const modelLabels = useMemo<Readonly<Record<string, string>>>(
    () =>
      Object.fromEntries(
        modelOptions.map((option) => [option.value, option.label]),
      ),
    [modelOptions],
  );
  const [modelCapabilities, setModelCapabilities] = useState<
    Record<string, { attachment?: boolean; image?: boolean }>
  >({});
  const [qwenNativeAvailable, setQwenNativeAvailable] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [agentModels, setAgentModels] = useState<
    Record<string, { providerID: string; modelID: string }>
  >({});
  // Seed Auto synchronously for tasks created from HomeView. Waiting for the
  // provider fetch leaves a render where the model is empty, allowing the
  // assistant-reply seeding effect to replace Auto with its resolved model.
  const [model, setModel] = useState(() =>
    readAutoTaskRecord(taskId) ? AUTO_MODEL_VALUE : "",
  );
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null,
  );
  const [agent, setAgent] = useState("");
  const [intelligence, setIntelligence] = useState<IntelligenceVariant | "">(
    "",
  );
  const [providerModelsMap, setProviderModelsMap] = useState<
    Record<string, ProviderModelMeta>
  >({});

  return {
    modelOptions,
    setModelOptions,
    modelLabels,
    modelCapabilities,
    setModelCapabilities,
    qwenNativeAvailable,
    setQwenNativeAvailable,
    agents,
    setAgents,
    agentModels,
    setAgentModels,
    model,
    setModel,
    serverDefaultModel,
    setServerDefaultModel,
    agent,
    setAgent,
    intelligence,
    setIntelligence,
    providerModelsMap,
    setProviderModelsMap,
  };
}
