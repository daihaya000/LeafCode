import { NextResponse } from "next/server";
import { ExtensionsError, httpStatusFromCode } from "./safe-move";

/**
 * Map service errors to safe API responses. ExtensionsError messages are
 * user-facing Japanese without internal paths; anything unexpected becomes
 * a generic message (no stack/OS details leak to the client).
 */
export function extensionsErrorResponse(
  err: unknown,
  fallback = "操作に失敗しました",
): NextResponse {
  if (err instanceof ExtensionsError) {
    return NextResponse.json(
      { error: err.message },
      { status: httpStatusFromCode(err.code) },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * Parse an icon-override request body: `{ icon: string | null }`.
 * `null`/omitted clears the override.
 */
export function parseIconBody(
  body: unknown,
): { icon: string | undefined } | { error: NextResponse } {
  const icon =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { icon?: unknown }).icon
      : undefined;
  if (icon !== undefined && icon !== null && typeof icon !== "string") {
    return {
      error: NextResponse.json(
        { error: "アイコンは文字列で指定してください" },
        { status: 400 },
      ),
    };
  }
  return { icon: typeof icon === "string" ? icon : undefined };
}

/**
 * Parse a configured-plugin add/update request body:
 * `{ name: string; options?: object }`. Further validation (blank name,
 * non-object options) happens in the service layer, which returns
 * user-facing errors via ExtensionsError.
 */
export function parsePluginBody(
  body: unknown,
): { name: string; options?: unknown } | { error: NextResponse } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: NextResponse.json({ error: "invalid body" }, { status: 400 }),
    };
  }
  const { name, options } = body as { name?: unknown; options?: unknown };
  if (typeof name !== "string") {
    return {
      error: NextResponse.json(
        { error: "name は文字列で指定してください" },
        { status: 400 },
      ),
    };
  }
  return { name, options };
}

/** Parse a toggle request body; the only accepted input shape. */
export function parseEnabledBody(
  body: unknown,
): { enabled: boolean } | { error: NextResponse } {
  const enabled =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { enabled?: unknown }).enabled
      : undefined;
  if (typeof enabled !== "boolean") {
    return {
      error: NextResponse.json(
        { error: "enabled は真偽値で指定してください" },
        { status: 400 },
      ),
    };
  }
  return { enabled };
}

/** Parse a per-provider bulk toggle body: `{ providerID, enabled }`. */
export function parseProviderEnabledBody(
  body: unknown,
): { providerID: string; enabled: boolean } | { error: NextResponse } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: NextResponse.json({ error: "invalid body" }, { status: 400 }),
    };
  }
  const { providerID, enabled } = body as {
    providerID?: unknown;
    enabled?: unknown;
  };
  if (typeof providerID !== "string" || !providerID.trim()) {
    return {
      error: NextResponse.json(
        { error: "providerID は文字列で指定してください" },
        { status: 400 },
      ),
    };
  }
  if (typeof enabled !== "boolean") {
    return {
      error: NextResponse.json(
        { error: "enabled は真偽値で指定してください" },
        { status: 400 },
      ),
    };
  }
  return { providerID, enabled };
}
