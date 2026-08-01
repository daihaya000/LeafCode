import { getJson, timedFetch } from "@/lib/client";
import type { HealthDto } from "@/lib/types";

const HEALTH_MAX_ATTEMPTS = 60;
const HEALTH_INTERVAL_MS = 1000;
const HEALTH_TIMEOUT_MS = 1500;

/**
 * Restart OpenCode via the host control plane and wait until it is healthy.
 *
 * Shared by AgentsSettings and ProfilesSettings so the polling logic lives
 * in one place.
 */
export async function restartOpencodeAndWait(): Promise<void> {
  const res = await timedFetch("/api/host/restart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "opencode" }),
    timeoutMs: 10_000,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    hint?: string;
  };
  if (!res.ok && res.status !== 202) {
    throw new Error(
      [data.error, data.hint].filter(Boolean).join(" — ") ||
        "再起動に失敗しました",
    );
  }

  for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i += 1) {
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    try {
      const h = await getJson<HealthDto>("/api/health", undefined, {
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      if (h.opencode?.ok === true) return;
    } catch {
      // still starting up
    }
  }
  throw new Error("OpenCode の再起動を確認できませんでした");
}
