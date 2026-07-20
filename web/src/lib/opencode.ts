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
