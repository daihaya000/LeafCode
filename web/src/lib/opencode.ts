export const OPENCODE_BASE_URL =
  process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";

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

  // Experimental control-plane / console
  if (m === "POST" && p === "/experimental/control-plane/move-session") return true;
  if (m === "POST" && p === "/experimental/console/switch") return true;

  // MCP OAuth DELETE — credential removal
  if (m === "DELETE" && /^\/mcp\/[^/]+\/auth$/.test(p)) return true;

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
