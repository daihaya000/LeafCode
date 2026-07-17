/**
 * Pure parsing + display helpers for the CodexBar usage snapshot
 * (`%APPDATA%\CodexBar\usage-snapshot.json`, schema `codexbar.usage-snapshot/v1`).
 *
 * Shared by the BFF route (server) and the widget (client): no Node/DOM deps.
 */

export const CODEXBAR_SCHEMA = "codexbar.usage-snapshot/v1";

export type CodexBarProvider = {
  /** codexBarProviderId (codex/claude/cursor/opencode-go/ollama), falls back to opencode id. */
  id: string;
  opencodeId: string | null;
  /** Max usage percent across windows (0..100+), or null if unknown. */
  usedPercent: number | null;
  limited: boolean;
  maxed: boolean;
  /** ISO-8601 timestamp of the earliest window reset, or null. */
  resetsAt: string | null;
  /** ISO-8601 timestamp this provider was fetched, or null. */
  updatedAt: string | null;
  /** Present only when the fetch failed. */
  error: string | null;
};

export type CodexBarUsage = {
  available: boolean;
  /** Human-readable reason when `available` is false. */
  reason: string | null;
  schema: string | null;
  generatedAt: string | null;
  providers: CodexBarProvider[];
};

export function emptyUsage(reason: string): CodexBarUsage {
  return {
    available: false,
    reason,
    schema: null,
    generatedAt: null,
    providers: [],
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Defensively normalize an arbitrary parsed snapshot into `CodexBarUsage`.
 * Never throws; unknown shapes yield `available: false`.
 */
export function parseCodexBarSnapshot(raw: unknown): CodexBarUsage {
  if (!raw || typeof raw !== "object") {
    return emptyUsage("スナップショットの形式が不正です");
  }
  const obj = raw as Record<string, unknown>;
  const list = obj.providers;
  if (!Array.isArray(list)) {
    return emptyUsage("providers 配列がありません");
  }

  const providers: CodexBarProvider[] = list
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === "object" && !Array.isArray(p),
    )
    .map((p) => {
      const usedPercent = asNumber(p.usedPercent);
      const limited = p.limited === true || (usedPercent !== null && usedPercent >= 90);
      const maxed = p.maxed === true || (usedPercent !== null && usedPercent >= 99.5);
      return {
        id: asString(p.codexBarProviderId) ?? asString(p.opencodeProviderId) ?? "unknown",
        opencodeId: asString(p.opencodeProviderId),
        usedPercent,
        limited,
        maxed,
        resetsAt: asString(p.resetsAt),
        updatedAt: asString(p.updatedAt),
        error: asString(p.error),
      };
    });

  return {
    available: true,
    reason: null,
    schema: asString(obj.schema),
    generatedAt: asString(obj.generatedAt),
    providers,
  };
}

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  "opencode-go": "OpenCode",
  ollama: "Ollama",
};

export function providerLabel(id: string): string {
  const known = PROVIDER_LABELS[id];
  if (known) return known;
  if (!id) return "Unknown";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export type UsageTone = "ok" | "warn" | "danger";

export function usageTone(
  p: Pick<CodexBarProvider, "usedPercent" | "limited" | "maxed" | "error">,
): UsageTone {
  if (p.error) return "danger";
  if (p.maxed || p.limited) return "danger";
  const u = p.usedPercent ?? 0;
  if (u >= 75) return "warn";
  return "ok";
}

/** Clamp a percent to the 0..100 range for bar widths (data may exceed 100). */
export function clampPercent(v: number | null): number {
  if (v === null || Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/** Relative "resets in" label in Japanese, or null when unknown/invalid. */
export function formatResetsIn(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - nowMs;
  if (diff <= 0) return "まもなく";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}分後`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間後`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}日${remHours}時間後` : `${days}日後`;
}

/**
 * CodexBar refreshes ~every 5 min; treat a snapshot older than 3 cycles as stale
 * (likely CodexBar is stopped or wedged).
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** True when `generatedAt` is older than the threshold. Unknown/invalid → false. */
export function isStale(
  generatedAt: string | null,
  nowMs: number,
  thresholdMs: number = STALE_AFTER_MS,
): boolean {
  if (!generatedAt) return false;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t > thresholdMs;
}

/** The provider with the highest usage (for a collapsed summary). Null if none. */
export function worstProvider(usage: CodexBarUsage): CodexBarProvider | null {
  let worst: CodexBarProvider | null = null;
  for (const p of usage.providers) {
    if (p.error) return p;
    if (!worst || (p.usedPercent ?? -1) > (worst.usedPercent ?? -1)) worst = p;
  }
  return worst;
}
