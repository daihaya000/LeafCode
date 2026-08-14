const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

export function resolveBrowserBroker(): { base: string; token: string } | null {
  const raw = process.env.LEAFCODE_BROWSER_BROKER;
  const token = process.env.LEAFCODE_BROWSER_BROKER_TOKEN;
  if (!raw || !token || token.length < 32) return null;
  try {
    const url = new URL(raw);
    if (!LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ""))) return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return { base: url.toString().replace(/\/$/, ""), token };
  } catch {
    return null;
  }
}

export async function browserBrokerFetch(path: string, init: RequestInit = {}) {
  const broker = resolveBrowserBroker();
  if (!broker) return null;
  return fetch(`${broker.base}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${broker.token}` },
    signal: AbortSignal.timeout(3000),
  });
}
