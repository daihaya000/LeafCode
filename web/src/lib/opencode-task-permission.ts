import { OcError, ocServer } from "@/lib/oc-server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";

export type TaskPermission = "allow" | "deny";

type AgentInfo = { name?: string; mode?: string; hidden?: boolean };

function upstreamError(data: unknown, status: number): OcError {
  const message =
    data && typeof data === "object"
      ? (data as { error?: unknown; message?: unknown }).error ??
        (data as { message?: unknown }).message
      : undefined;
  return new OcError(
    typeof message === "string" ? message : `OpenCode /config failed: ${status}`,
    status,
  );
}

/**
 * The only configuration write WebUI performs. The target must be a visible
 * primary/all agent returned by OpenCode; callers cannot name an arbitrary
 * config key or provide any config payload.
 */
export async function setAgentTaskPermission(
  directory: string,
  agent: string,
  permission: TaskPermission,
): Promise<void> {
  const agentName = agent.trim();
  if (!agentName || agentName.length > 128) {
    throw new OcError("invalid agent", 400);
  }

  const agents = await ocServer<AgentInfo[]>(directory, "/agent");
  const executor = agents.find(
    (item) =>
      item.name === agentName && item.mode !== "subagent" && !item.hidden,
  );
  if (!executor) {
    throw new OcError("execution agent not found", 404);
  }

  // OpenCode's generated `config.update` schema accepts Config (all members
  // optional). Keep this intentionally minimal: PATCH only agent.<name>
  // .permission.task and never relay a client-supplied Config object.
  const response = await fetch(new URL("/config", OPENCODE_BASE_URL), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-opencode-directory": directory,
    },
    body: JSON.stringify({
      agent: { [agentName]: { permission: { task: permission } } },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    throw new OcError(
      err instanceof Error ? err.message : "OpenCode engine unavailable",
      503,
    );
  });

  if (!response.ok) {
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    throw upstreamError(data, response.status);
  }
}
