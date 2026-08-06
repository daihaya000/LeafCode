import { NextResponse } from "next/server";
import { ocServer, OcError } from "@/lib/oc-server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";
import { requireAuthorized } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderAuthMethod = {
  type?: unknown;
  label?: unknown;
};

type AuthorizationResponse = {
  url?: unknown;
  method?: unknown;
  instructions?: unknown;
};

function errorResponse(error: unknown) {
  if (error instanceof OcError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "OpenAI のブラウザ認証を開始できません" },
    { status: 503 },
  );
}

function isBrowserOAuth(method: ProviderAuthMethod | undefined): boolean {
  return (
    method?.type === "oauth" &&
    typeof method.label === "string" &&
    /browser|ブラウザ/i.test(method.label)
  );
}

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => undefined)) as
    | { method?: unknown }
    | undefined;
  const methodIndex = body?.method;
  if (!Number.isInteger(methodIndex) || (methodIndex as number) < 0) {
    return NextResponse.json(
      { error: "認証方式を指定してください" },
      { status: 400 },
    );
  }

  try {
    // Keep the generic OpenCode proxy's credential-write block in place. This
    // route is the intentionally narrow, OpenAI-browser-only exception.
    const methods = await ocServer<Record<string, ProviderAuthMethod[]>>(
      null,
      "/provider/auth",
    );
    const selected = methods.openai?.[methodIndex as number];
    if (!isBrowserOAuth(selected)) {
      return NextResponse.json(
        { error: "OpenAI のブラウザ認証方式が見つかりません" },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      new URL("/provider/openai/oauth/authorize", OPENCODE_BASE_URL),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: methodIndex }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const result = (await upstream.json().catch(() => undefined)) as
      | AuthorizationResponse
      | undefined;
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "OpenAI のブラウザ認証を開始できません" },
        { status: upstream.status },
      );
    }

    if (
      typeof result?.url !== "string" ||
      !result.url.startsWith("https://auth.openai.com/") ||
      (result.method !== "auto" && result.method !== "code")
    ) {
      return NextResponse.json(
        { error: "OpenAI から不正な認証情報が返されました" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      url: result.url,
      method: result.method,
      instructions:
        typeof result.instructions === "string" ? result.instructions : undefined,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
