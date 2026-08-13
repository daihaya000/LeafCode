import { ocServer } from "@/lib/oc-server";
import {
  cachedAgentsByDir,
  cachedProvidersByDir,
  readBoundedCapabilityCache,
  setBoundedCapabilityCache,
  type AgentResponse,
  type ProviderResponse,
} from "@/lib/opencode-proxy/cache";

/**
 * Model / provider capability resolution for the BFF proxy (REFACTORING_PLAN
 * P4-a): which model a request selects, whether it supports image input, and
 * seeding the per-directory capability cache from upstream metadata replies.
 */

export function modelFromRequest(body: Record<string, unknown>):
  | { providerID: string; modelID: string }
  | undefined {
  const model = body.model;
  if (typeof model === "string") {
    const slash = model.indexOf("/");
    if (slash > 0 && slash < model.length - 1) {
      return {
        providerID: model.slice(0, slash),
        modelID: model.slice(slash + 1),
      };
    }
    return undefined;
  }
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    return undefined;
  }
  const { providerID, modelID } = model as {
    providerID?: unknown;
    modelID?: unknown;
  };
  return typeof providerID === "string" && typeof modelID === "string"
    ? { providerID, modelID }
    : undefined;
}

// Resolves `/agent`, preferring the per-directory cache seeded by an earlier
// directory-scoped GET (see cacheCapabilityMetadata). If unseeded — e.g. the
// composer only ever fetched it without a `directory`, which is never cached
// — fall back to a live, directory-scoped query so capability enforcement
// does not incorrectly fail-closed for a directory whose cache never filled.
export async function resolveAgents(directory: string | null): Promise<AgentResponse | undefined> {
  const cached = directory ? readBoundedCapabilityCache(cachedAgentsByDir, directory) : undefined;
  if (cached) return cached;
  try {
    const agents = await ocServer<AgentResponse>(directory, "/agent");
    if (directory) setBoundedCapabilityCache(cachedAgentsByDir, directory, agents);
    return agents;
  } catch {
    return undefined;
  }
}

// Same directory-scoped cache-then-live-fallback strategy as resolveAgents,
// mirroring the supportsImageInput() implementation in /api/tasks so both
// write paths make the same fail-closed decision from the same source of
// truth (OpenCode's live /provider capabilities for this directory).
export async function resolveProviders(directory: string | null): Promise<ProviderResponse | undefined> {
  const cached = directory ? readBoundedCapabilityCache(cachedProvidersByDir, directory) : undefined;
  if (cached) return cached;
  try {
    const providers = await ocServer<ProviderResponse>(directory, "/provider");
    if (directory) setBoundedCapabilityCache(cachedProvidersByDir, directory, providers);
    return providers;
  } catch {
    return undefined;
  }
}

export async function supportsImageInput(
  directory: string | null,
  body: unknown,
): Promise<boolean> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as Record<string, unknown>;
  let model = modelFromRequest(request);
  const agent = request.agent;
  if (typeof agent === "string" && agent.trim()) {
    const agents = await resolveAgents(directory);
    const configuredAgent = agents?.find(({ name }) => name === agent.trim());
    const agentModel = configuredAgent?.model;
    // Prefer the agent's own model when it is configured; otherwise fall back
    // to the model explicitly selected in the request. This lets an
    // image-capable model chosen at request time apply to agents that have no
    // per-agent model, instead of fail-closing on the missing agent model.
    if (agentModel?.providerID && agentModel.modelID) {
      model = {
        providerID: agentModel.providerID,
        modelID: agentModel.modelID,
      };
    }
  }
  if (!model?.providerID || !model.modelID) return false;
  const providers = await resolveProviders(directory);
  // Unreachable/unavailable provider metadata is fail-closed: without a
  // confirmed capability we cannot allow the image through.
  if (!providers) return false;
  if (
    providers.connected?.length &&
    !providers.connected.includes(model.providerID)
  ) {
    return false;
  }
  const capabilities = providers.all
    ?.find((provider) => provider.id === model.providerID)
    ?.models?.[model.modelID]?.capabilities;
  return capabilities?.input?.image === true || capabilities?.attachment === true;
}

export async function cacheCapabilityMetadata(
  directory: string | null,
  pathname: string,
  upstream: Response,
): Promise<void> {
  if (!directory) return; // Cannot cache without directory key
  if (!upstream.ok || !upstream.headers.get("content-type")?.includes("application/json")) {
    return;
  }
  try {
    const payload = await upstream.clone().json();
    if (pathname === "/provider") setBoundedCapabilityCache(cachedProvidersByDir, directory, payload as ProviderResponse);
    if (pathname === "/agent" && Array.isArray(payload)) {
      setBoundedCapabilityCache(cachedAgentsByDir, directory, payload as AgentResponse);
    }
  } catch {
    // A malformed metadata response leaves the cache unavailable, which is
    // fail-closed for subsequent image submissions.
  }
}
