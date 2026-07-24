import { ocServer } from "../oc-server";
import type { McpDto, McpRuntimeStatus } from "../extensions";
import {
  parseJsoncConfig,
  readConfigContent,
  setMcpEnabledInContent,
  updateConfigFile,
} from "./jsonc-edit";
import { opencodeConfigFilePath } from "./paths";
import { ExtensionsError } from "./safe-move";

const RUNTIME_STATUSES = new Set<string>([
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
]);

type RuntimeMap = {
  available: boolean;
  statuses: Map<string, McpRuntimeStatus>;
};

/** Live `/mcp` statuses from the engine; `available: false` when unreachable. */
async function fetchMcpRuntime(): Promise<RuntimeMap> {
  try {
    const raw = await ocServer<Record<string, { status?: unknown }> | null>(
      null,
      "/mcp",
      { timeoutMs: 3000 },
    );
    const statuses = new Map<string, McpRuntimeStatus>();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [name, value] of Object.entries(raw)) {
        const status = value?.status;
        if (typeof status === "string" && RUNTIME_STATUSES.has(status)) {
          statuses.set(name, status as McpRuntimeStatus);
        }
      }
    }
    return { available: true, statuses };
  } catch {
    return { available: false, statuses: new Map() };
  }
}

// Command-line arguments that embed credentials, e.g. `--token=abc`.
const SECRET_ARG = /^(--?(?:token|key|secret|password|api[-_]?key)=).+/i;
const SECRET_QUERY = /key|token|secret|password|sig|auth/i;

/** Join a local server command, masking credential-looking arguments. */
export function maskCommandArgs(command: unknown): string {
  if (!Array.isArray(command)) return "";
  return command
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.replace(SECRET_ARG, "$1***"))
    .join(" ");
}

/** Mask userinfo and secret-looking query params; never return raw on failure. */
export function maskUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return "(URL)";
  }
}

function plainObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function buildMcpDto(name: string, raw: unknown, runtime: RuntimeMap): McpDto {
  const entry =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const enabled = entry.enabled !== false;
  const declaredType = entry.type;
  const type: McpDto["type"] =
    declaredType === "local"
      ? "local"
      : declaredType === "remote"
        ? "remote"
        : Array.isArray(entry.command)
          ? "local"
          : typeof entry.url === "string"
            ? "remote"
            : "unknown";

  let detail = "";
  let meta: string | undefined;
  if (type === "local") {
    detail = maskCommandArgs(entry.command);
    const envKeys = plainObjectKeys(entry.env);
    if (envKeys.length > 0) meta = `env: ${envKeys.join(", ")}`;
  } else if (type === "remote") {
    detail = maskUrl(entry.url);
    const headerNames = plainObjectKeys(entry.headers);
    if (headerNames.length > 0) meta = `headers: ${headerNames.join(", ")}`;
  }

  const status = runtime.statuses.get(name);
  // Config/runtime disagree → the engine still runs the pre-restart state.
  const pendingRestart =
    runtime.available &&
    ((enabled && status === "disabled") ||
      (!enabled && status !== undefined && status !== "disabled"));

  const dto: McpDto = {
    id: name,
    name,
    type,
    detail,
    enabled,
    pendingRestart,
    engineAvailable: runtime.available,
  };
  if (meta) dto.meta = meta;
  if (status) dto.runtime = status;
  return dto;
}

export async function listMcpServers(): Promise<McpDto[]> {
  const content = readConfigContent(opencodeConfigFilePath());
  const root = parseJsoncConfig(content);
  const mcp = root.mcp;
  const entries: [string, unknown][] =
    mcp && typeof mcp === "object" && !Array.isArray(mcp)
      ? Object.entries(mcp as Record<string, unknown>)
      : [];
  const runtime = await fetchMcpRuntime();
  return entries
    .map(([name, raw]) => buildMcpDto(name, raw, runtime))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function assertValidMcpName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 255 ||
    /[\x00-\x1f]/.test(name)
  ) {
    throw new ExtensionsError("invalid-name", "MCP サーバー名が不正です");
  }
}

/**
 * Flip only `mcp[name].enabled` in the global config. `updateConfigFile`
 * guarantees the re-read → minimal JSONC edit → atomic write cycle runs
 * inside the process-wide config lock, so concurrent toggles cannot
 * clobber each other with a stale read.
 */
export async function setMcpEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  assertValidMcpName(name);
  await updateConfigFile(opencodeConfigFilePath(), (content) =>
    setMcpEnabledInContent(content, name, enabled),
  );
}
