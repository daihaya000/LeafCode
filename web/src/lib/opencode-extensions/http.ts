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
