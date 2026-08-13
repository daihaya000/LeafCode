import { NextRequest, NextResponse } from "next/server";
import { isAutoOptimizeMode, normalizeRouteOverrides } from "@/lib/auto-model";
import {
  COMMIT_AUTHOR_EMAIL_KEY,
  COMMIT_AUTHOR_NAME_KEY,
  isValidCommitAuthorEmail,
  isValidCommitAuthorName,
} from "@/lib/commit-identity-keys";
import { getSetting, setSetting } from "@/lib/db";
import { requireAuthorized } from "@/lib/api-guard";
import { withReadCache } from "@/lib/http-cache";
import { WORKFLOW_MODE_SETTING_KEY } from "@/lib/workflow-feature";
import {
  MEMORY_ENABLED_SETTING_KEY,
  MEMORY_WRITE_APPROVAL_SETTING_KEY,
} from "@/lib/memory-settings";
import {
  isTokenSavingMode,
  TOKEN_SAVING_SETTING_KEY,
  TOKEN_SAVING_THRESHOLD_KEY,
  clampThreshold,
  MAX_TOKEN_SAVING_THRESHOLD,
  MIN_TOKEN_SAVING_THRESHOLD,
} from "@/lib/token-saving-settings";
import { GENERATION_MODEL_EFFORT_SETTING_KEY, GENERATION_MODEL_SETTING_KEY } from "@/lib/generation-model";
import {
  isOpenCodeApiGeneration,
  OPENCODE_API_GENERATION_SETTING_KEY,
} from "@/lib/opencode-generation";
import { isIntelligenceVariant } from "@/lib/model-variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Allowlist of setting keys that may be read/written through this generic
 * route. Keeps arbitrary clients from overwriting unrelated rows in the
 * `settings` table.
 */
const ALLOWED_KEYS = new Set<string>([
  "auto-optimize",
  "auto-show-model",
  "auto-route-overrides",
  "default-model",
  "default-model-effort",
  "sidebar",
  "sidepanel-width",
  "hang-timeout",
  WORKFLOW_MODE_SETTING_KEY,
  MEMORY_WRITE_APPROVAL_SETTING_KEY,
  MEMORY_ENABLED_SETTING_KEY,
  COMMIT_AUTHOR_NAME_KEY,
  COMMIT_AUTHOR_EMAIL_KEY,
  TOKEN_SAVING_SETTING_KEY,
  TOKEN_SAVING_THRESHOLD_KEY,
  GENERATION_MODEL_SETTING_KEY,
  GENERATION_MODEL_EFFORT_SETTING_KEY,
  OPENCODE_API_GENERATION_SETTING_KEY,
]);

/** Auto toggles are stored as `"1"` (on) or `""` (unset / off). */
const BOOLEAN_SETTING_KEYS = new Set<string>([
  "auto-show-model",
  WORKFLOW_MODE_SETTING_KEY,
  MEMORY_WRITE_APPROVAL_SETTING_KEY,
]);

const MAX_SETTING_VALUE_CHARS = 32_768;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEPANEL_MIN_WIDTH = 280;
const SIDEPANEL_MAX_WIDTH = 900;
const DEFAULT_MODEL_MAX_CHARS = 512;
const HANG_TIMEOUT_MIN_MS = 10_000;
const HANG_TIMEOUT_MAX_MS = 30 * 60_000;

function isAllowedKey(key: string): key is string {
  return ALLOWED_KEYS.has(key);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalize / reject key-specific payloads. Returns the string to store, or an
 * error message. Empty string means "unset" and is always allowed.
 */
function normalizeSettingValue(
  key: string,
  value: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (value.length === 0) return { ok: true, value: "" };

  if (key === "default-model") {
    if (value.length > DEFAULT_MODEL_MAX_CHARS) {
      return { ok: false, error: "default-model is too long" };
    }
    // provider::model — reject whitespace / empty segments
    if (!/^[^:\s]+::\S+$/.test(value)) {
      return {
        ok: false,
        error: "default-model must be provider::model",
      };
    }
    return { ok: true, value };
  }

  if (key === GENERATION_MODEL_SETTING_KEY) {
    if (value.length > DEFAULT_MODEL_MAX_CHARS || !/^[^:\s]+::\S+$/.test(value)) {
      return { ok: false, error: "generation-model must be provider::model" };
    }
    return { ok: true, value };
  }

  if (key === "default-model-effort" || key === GENERATION_MODEL_EFFORT_SETTING_KEY) {
    if (value.length > DEFAULT_MODEL_MAX_CHARS || !isIntelligenceVariant(value)) {
      return {
        ok: false,
        error: `${key} must be a valid reasoning effort (e.g. low, medium, high)`,
      };
    }
    return { ok: true, value };
  }

  if (key === "hang-timeout") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < HANG_TIMEOUT_MIN_MS || n > HANG_TIMEOUT_MAX_MS) {
      return { ok: false, error: "hang-timeout must be between 10000 and 1800000 milliseconds" };
    }
    return { ok: true, value: String(Math.round(n)) };
  }

  if (key === COMMIT_AUTHOR_NAME_KEY) {
    // Reject rather than silently trim: the value ends up in a Git commit
    // header, so the user should see exactly what will be stamped.
    if (!isValidCommitAuthorName(value)) {
      return {
        ok: false,
        error: "commit-author-name contains characters Git cannot store",
      };
    }
    return { ok: true, value };
  }

  if (key === COMMIT_AUTHOR_EMAIL_KEY) {
    if (!isValidCommitAuthorEmail(value)) {
      return { ok: false, error: "commit-author-email must be an email address" };
    }
    return { ok: true, value };
  }

  if (key === "auto-optimize") {
    if (!isAutoOptimizeMode(value)) {
      return {
        ok: false,
        error: "auto-optimize must be cost, balanced or intelligence",
      };
    }
    return { ok: true, value };
  }

  if (key === "auto-route-overrides") {
    try {
      const parsed = JSON.parse(value);
      const normalized = normalizeRouteOverrides(parsed);
      return { ok: true, value: JSON.stringify(normalized) };
    } catch {
      return { ok: false, error: "auto-route-overrides must be JSON" };
    }
  }

  if (key === TOKEN_SAVING_SETTING_KEY) {
    if (!isTokenSavingMode(value)) {
      return {
        ok: false,
        error: "token-saving must be off, suggest or auto",
      };
    }
    return { ok: true, value };
  }

  if (key === TOKEN_SAVING_THRESHOLD_KEY) {
    const n = Number(value);
    if (
      !Number.isFinite(n) ||
      n < MIN_TOKEN_SAVING_THRESHOLD ||
      n > MAX_TOKEN_SAVING_THRESHOLD
    ) {
      return {
        ok: false,
        error: `token-saving-threshold must be between ${MIN_TOKEN_SAVING_THRESHOLD} and ${MAX_TOKEN_SAVING_THRESHOLD}`,
      };
    }
    return { ok: true, value: String(clampThreshold(n)) };
  }

  if (key === MEMORY_ENABLED_SETTING_KEY) {
    // Tri-state on purpose: "1" on, "0" off, unset on (the pre-switch default).
    // Storing "1" explicitly lets the UI show that the user chose it.
    if (value !== "0" && value !== "1") {
      return { ok: false, error: `${key} must be 0 or 1` };
    }
    return { ok: true, value };
  }

  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (value !== "1") {
      return { ok: false, error: `${key} must be 1 or empty` };
    }
    return { ok: true, value };
  }

  if (key === "sidepanel-width") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return { ok: false, error: "sidepanel-width must be a number" };
    }
    return {
      ok: true,
      value: String(clampInt(n, SIDEPANEL_MIN_WIDTH, SIDEPANEL_MAX_WIDTH)),
    };
  }

  if (key === "sidebar") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ok: false, error: "sidebar must be JSON" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "sidebar must be an object" };
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.expanded) || !obj.expanded.every((id) => typeof id === "string")) {
      return { ok: false, error: "sidebar.expanded must be a string array" };
    }
    if (typeof obj.width !== "number" || !Number.isFinite(obj.width)) {
      return { ok: false, error: "sidebar.width must be a number" };
    }
    if (typeof obj.archivedExpanded !== "boolean") {
      return { ok: false, error: "sidebar.archivedExpanded must be a boolean" };
    }
    const normalized = {
      expanded: obj.expanded.map(String).slice(0, 500),
      width: clampInt(obj.width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
      archivedExpanded: obj.archivedExpanded,
    };
    return { ok: true, value: JSON.stringify(normalized) };
  }

  if (key === OPENCODE_API_GENERATION_SETTING_KEY) {
    if (!isOpenCodeApiGeneration(value)) {
      return { ok: false, error: "opencode-api-generation must be v1 or v2" };
    }
    return { ok: true, value };
  }

  return { ok: true, value };
}

export async function GET(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "unknown setting key" }, { status: 400 });
  }
  const value = getSetting(key);
  return withReadCache(
    NextResponse.json({
      value: value && value.length > 0 ? value : null,
    }),
  );
}

export async function PUT(req: NextRequest,
  context: { params: Promise<{ key: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { key } = await context.params;
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "unknown setting key" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { value?: unknown }
    | null;

  if (!body || typeof body !== "object" || !("value" in body)) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }

  const { value } = body;
  if (value !== null && typeof value !== "string") {
    return NextResponse.json(
      { error: "value must be a string or null" },
      { status: 400 },
    );
  }

  // Cap payload size: this BFF is LAN-reachable without auth.
  if (typeof value === "string" && value.length > MAX_SETTING_VALUE_CHARS) {
    return NextResponse.json(
      { error: `value exceeds ${MAX_SETTING_VALUE_CHARS} characters` },
      { status: 400 },
    );
  }

  // Treat empty string / null as "unset".
  const raw = typeof value === "string" && value.length > 0 ? value : "";
  const normalized = normalizeSettingValue(key, raw);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  setSetting(key, normalized.value);
  return NextResponse.json({ ok: true });
}
