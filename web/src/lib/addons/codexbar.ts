/**
 * Pure parsing + display helpers for the CodexBar usage snapshot
 * (`%APPDATA%\CodexBar\usage-snapshot.json`, schema `codexbar.usage-snapshot/v1`).
 *
 * Shared by the BFF route (server) and the widget (client): no Node/DOM deps.
 */

export const CODEXBAR_SCHEMA = "codexbar.usage-snapshot/v1";

/** A single rate-limit window (e.g. 5時間 / 週間 / 月間) for a provider. */
export type CodexBarWindow = {
  id: string;
  title: string;
  usedPercent: number | null;
  resetsAt: string | null;
  /** Window length in minutes (e.g. 300 = 5h, 10080 = weekly), or null. */
  windowMinutes: number | null;
};

export type CodexBarCredits = {
  title: string | null;
  used: number | null;
  limit: number | null;
  balance: number | null;
};

export type CodexBarProvider = {
  /** codexBarProviderId (codex/claude/cursor/opencode-go/ollama), falls back to opencode id. */
  id: string;
  opencodeId: string | null;
  /** Subscription/plan label (e.g. Pro/Max/Go), or null when unknown. */
  plan: string | null;
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
  /** Per-window detail (5時間/週間/…). Empty for older snapshots. */
  windows: CodexBarWindow[];
  /** Optional monetary credit allowance, separate from rate-limit windows. */
  credits: CodexBarCredits | null;
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
      const windows: CodexBarWindow[] = Array.isArray(p.windows)
        ? p.windows
            .filter(
              (w): w is Record<string, unknown> =>
                !!w && typeof w === "object" && !Array.isArray(w),
            )
            .map((w) => ({
              id: asString(w.id) ?? "",
              title: asString(w.title) ?? "",
              usedPercent: asNumber(w.usedPercent),
              resetsAt: asString(w.resetsAt),
              windowMinutes: asNumber(w.windowMinutes),
            }))
        : [];
      const creditValue = p.credits;
      const credits: CodexBarCredits | null =
        creditValue && typeof creditValue === "object" && !Array.isArray(creditValue)
          ? {
              title: asString((creditValue as Record<string, unknown>).title),
              used: asNumber((creditValue as Record<string, unknown>).used),
              limit: asNumber((creditValue as Record<string, unknown>).limit),
              balance: asNumber((creditValue as Record<string, unknown>).balance),
            }
          : null;
      return {
        id: asString(p.codexBarProviderId) ?? asString(p.opencodeProviderId) ?? "unknown",
        opencodeId: asString(p.opencodeProviderId),
        plan: asString(p.plan),
        usedPercent,
        limited,
        maxed,
        resetsAt: asString(p.resetsAt),
        updatedAt: asString(p.updatedAt),
        error: asString(p.error),
        windows,
        credits,
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

/** Brand icons shared with the CodexBar desktop app (web/public/addons/codexbar). */
const PROVIDER_ICONS: Record<string, string> = {
  codex: "codex.png",
  claude: "claude.png",
  cursor: "cursor.png",
  ollama: "ollama.png",
  "opencode-go": "opencode.png",
  opencode: "opencode.png",
};

/** Public path of a provider's icon, or null when there is no bundled icon. */
export function providerIconSrc(id: string): string | null {
  const file = PROVIDER_ICONS[id];
  return file ? `/addons/codexbar/${file}` : null;
}

/**
 * Map an OpenCode provider id (e.g. "openai", "anthropic", "ollama",
 * "opencode-go") to the CodexBar brand icon key. CodexBar bundles a handful
 * of brand icons (codex/claude/cursor/ollama/opencode); OpenCode provider ids
 * are a superset, so we alias the common ones and fall back to null when no
 * matching brand icon exists.
 */
const OPENCODE_TO_CODEXBAR: Record<string, string> = {
  openai: "codex",
  anthropic: "claude",
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  "cursor-acp": "cursor",
  ollama: "ollama",
  "ollama-cloud": "ollama",
  "opencode-go": "opencode-go",
  opencode: "opencode",
};

/** Public path of a brand icon for an OpenCode provider id, or null. */
export function providerIconSrcForOpencodeId(
  opencodeId: string,
): string | null {
  const key = OPENCODE_TO_CODEXBAR[opencodeId];
  return key ? providerIconSrc(key) : null;
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

/** Tone from a bare percent (for individual windows): >=90 danger, >=75 warn. */
export function percentTone(usedPercent: number | null): UsageTone {
  const u = usedPercent ?? 0;
  if (u >= 90) return "danger";
  if (u >= 75) return "warn";
  return "ok";
}

/**
 * Overall usage across all providers = mean of each provider's usedPercent.
 * Used for the collapsed pill so it reflects the whole picture rather than
 * only the single busiest provider. Null when no numeric data.
 */
export function overallUsedPercent(usage: CodexBarUsage): number | null {
  const vals = usage.providers
    .map((p) => p.usedPercent)
    .filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** How many providers are at/over their limit (limited or maxed). */
export function limitedCount(usage: CodexBarUsage): number {
  return usage.providers.filter((p) => p.limited || p.maxed).length;
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
