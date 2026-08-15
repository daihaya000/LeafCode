export const OPENCODE_BASE_URL =
  process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";

/** Default engine port when OPENCODE_PORT is unset (mirrors host/src/index.js). */
const DEFAULT_ENGINE_PORT = 4096;
/** How many consecutive ports to scan after the primary port. */
const ENGINE_PORT_SCAN_RANGE = 16;
/** Per-port health probe timeout. */
const ENGINE_HEALTH_TIMEOUT_MS = 1500;

/**
 * Probe whether an engine is live at `url`. A health check is only "the
 * engine" when it answers ok with a JSON `{healthy: true, version}` body, so
 * an unrelated app squatting on a fallback port is never mistaken for one.
 */
export async function engineHealthyAt(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/global/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ENGINE_HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as
      | { healthy?: unknown; version?: unknown }
      | null;
    return body?.healthy === true && typeof body.version === "string";
  } catch {
    return false;
  }
}

/**
 * Find the live engine URL. The host launches the WebUI with the resolved
 * OPENCODE_BASE_URL, so the primary URL only fails when the engine moved to a
 * fallback port before the host restarted the WebUI (ghost sockets bump it
 * 4096 → 4097 → …). In that case scan the host's fallback range starting at
 * OPENCODE_PORT (default 4096) and return the first live engine. Falls back
 * to the primary URL when nothing answers, so callers surface the connection
 * error instead of silently pointing at an unrelated app.
 */
export async function discoverEngineUrl(): Promise<string> {
  if (await engineHealthyAt(OPENCODE_BASE_URL)) {
    return OPENCODE_BASE_URL;
  }
  const startPort =
    Number.parseInt(process.env.OPENCODE_PORT ?? "", 10) || DEFAULT_ENGINE_PORT;
  for (let port = startPort; port < startPort + ENGINE_PORT_SCAN_RANGE; port++) {
    const url = `http://127.0.0.1:${port}`;
    if (url === OPENCODE_BASE_URL) continue;
    if (await engineHealthyAt(url)) {
      return url;
    }
  }
  return OPENCODE_BASE_URL;
}

let resolvedEngineUrl: string | null = null;
let engineUrlPromise: Promise<string> | null = null;

/**
 * Resolve the engine base URL, scanning fallback ports when the configured
 * OPENCODE_BASE_URL is unreachable. Resolved once per process and shared
 * between concurrent callers; tests always get the configured URL so they
 * never probe the network.
 */
export function resolveOpencodeBaseUrl(): Promise<string> {
  if (process.env.NODE_ENV === "test") {
    return Promise.resolve(OPENCODE_BASE_URL);
  }
  if (resolvedEngineUrl) return Promise.resolve(resolvedEngineUrl);
  if (!engineUrlPromise) {
    engineUrlPromise = discoverEngineUrl().then((url) => {
      resolvedEngineUrl = url;
      engineUrlPromise = null;
      return url;
    });
  }
  return engineUrlPromise;
}

/** Paths/methods the WebUI must never forward (config writes). */
export function isBlockedOpencodeWrite(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  const p = pathname.replace(/\/+$/, "") || "/";

  if (
    m === "PATCH" &&
    (p === "/config" ||
      p.startsWith("/config/") ||
      p === "/global/config" ||
      p.startsWith("/global/config/"))
  ) {
    return true;
  }
  if (m === "PUT" && (p === "/auth" || p.startsWith("/auth/"))) return true;
  if (m === "POST" && (p === "/mcp" || p.startsWith("/mcp/"))) return true;
  if (m === "DELETE" && (p === "/auth" || p.startsWith("/auth/"))) return true;
  if (m === "PUT" && p.startsWith("/auth/")) return true;

  // Provider / integration OAuth + API key — credential injection
  if (
    m === "POST" &&
    (/^\/provider\/[^/]+\/oauth\/(authorize|callback)$/.test(p) ||
      /^\/api\/integration\/[^/]+\/connect\/(oauth|key)$/.test(p) ||
      /^\/api\/integration\/attempt\/[^/]+\/complete$/.test(p))
  ) {
    return true;
  }
  // Cancel an in-flight OAuth attempt
  if (m === "DELETE" && /^\/api\/integration\/attempt\/[^/]+$/.test(p)) {
    return true;
  }

  // Stored integration credentials — delete / relabel
  if (
    (m === "DELETE" || m === "PATCH") &&
    /^\/api\/credential\/[^/]+$/.test(p)
  ) {
    return true;
  }

  // Session shell — arbitrary command execution (PTY-equivalent)
  if (m === "POST" && /^\/session\/[^/]+\/shell$/.test(p)) return true;
  if (m === "POST" && /^\/api\/session\/[^/]+\/shell$/.test(p)) return true;

  // PTY create/update/delete/connect-token — remote shell equivalent
  if (m === "POST" && p === "/pty") return true;
  if (m === "PUT" && p.startsWith("/pty/")) return true;
  if (m === "DELETE" && p.startsWith("/pty/")) return true;
  if (m === "POST" && /^\/pty\/[^/]+\/connect-token$/.test(p)) return true;

  // /api/pty variants (v2 API proxied through /api/opencode/[...path])
  if (m === "POST" && p === "/api/pty") return true;
  if (m === "PUT" && p.startsWith("/api/pty/")) return true;
  if (m === "DELETE" && p.startsWith("/api/pty/")) return true;
  if (m === "POST" && /^\/api\/pty\/[^/]+\/connect-token$/.test(p)) return true;

  // Engine dispose — unauthenticated shutdown
  if (m === "POST" && (p === "/global/dispose" || p === "/instance/dispose")) return true;

  // VCS patch apply — arbitrary patch to working tree
  if (m === "POST" && p === "/vcs/apply") return true;

  // Experimental worktree/workspace writes — git tree destruction
  if (m === "POST" && p === "/experimental/worktree") return true;
  if (m === "DELETE" && p === "/experimental/worktree") return true;
  if (m === "POST" && p === "/experimental/worktree/reset") return true;
  if (m === "POST" && p === "/experimental/workspace") return true;
  if (m === "DELETE" && p.startsWith("/experimental/workspace/")) return true;
  if (m === "POST" && p === "/experimental/workspace/sync-list") return true;
  if (m === "POST" && p === "/experimental/workspace/warp") return true;

  // Experimental project copy — unintended disk side effects
  if (
    (m === "POST" || m === "DELETE") &&
    /^\/experimental\/project\/[^/]+\/copy$/.test(p)
  ) {
    return true;
  }
  if (
    m === "POST" &&
    /^\/experimental\/project\/[^/]+\/copy\/refresh$/.test(p)
  ) {
    return true;
  }

  // Experimental control-plane / console
  if (m === "POST" && p === "/experimental/control-plane/move-session") return true;
  if (m === "POST" && p === "/experimental/console/switch") return true;

  // MCP OAuth DELETE — credential removal
  if (m === "DELETE" && /^\/mcp\/[^/]+\/auth$/.test(p)) return true;

  // Global upgrade — destructive self-update
  if (m === "POST" && p === "/global/upgrade") return true;

  // Sync steal — takes over another peer's sync lease
  if (m === "POST" && p === "/sync/steal") return true;

  // Project git init — mutates working tree
  if (m === "POST" && p === "/project/git/init") return true;

  // Session init — writes AGENTS.md / project scaffolding into the workspace
  if (m === "POST" && /^\/session\/[^/]+\/init$/.test(p)) return true;
  if (m === "POST" && /^\/api\/session\/[^/]+\/init$/.test(p)) return true;

  // Project update — renames/reconfigures a project
  if (m === "PATCH" && /^\/project\/[^/]+$/.test(p)) return true;

  // Session share create/revoke — exposes a public link
  if (m === "POST" && /^\/session\/[^/]+\/share$/.test(p)) return true;
  if (m === "DELETE" && /^\/session\/[^/]+\/share$/.test(p)) return true;

  // Experimental session background — mutates run state
  if (m === "POST" && /^\/experimental\/session\/[^/]+\/background$/.test(p)) return true;

  // TUI remote control — drives the desktop TUI
  if ((m === "POST" || m === "PUT") && (p === "/tui" || p.startsWith("/tui/"))) return true;

  // Saved permission removal — deletes stored approvals
  if (m === "DELETE" && /^\/(api\/)?permission\/saved\/[^/]+$/.test(p)) return true;

  return false;
}

export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(k) && typeof v === "string") {
        out[k] = v.length <= 8 ? "********" : `${v.slice(0, 4)}…********`;
      } else {
        out[k] = maskSecrets(v);
      }
    }
    return out;
  }
  return value;
}
