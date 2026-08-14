import { useMemo, useState } from "react";
import { type ModelOption } from "@/lib/model-options";
import { type IntelligenceVariant, type ProviderModelMeta } from "@/lib/model-variants";

export type AgentModelEntry = {
  providerID: string;
  modelID: string;
  variant?: string;
};

/**
 * Shared model/provider/agent selection state for the composer surfaces
 * (HomeView and TaskView; REFACTORING_PLAN 5-b / IMPROVEMENT 1-1). Provider /
 * agent fetching stays in the caller.
 */
export function useModelConfigState(initialModel: () => string = () => "") {
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
  const [agentModels, setAgentModels] = useState<Record<string, AgentModelEntry>>(
    {},
  );
  const [model, setModel] = useState(initialModel);
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
