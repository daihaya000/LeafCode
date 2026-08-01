import { NextResponse } from "next/server";
import { ocServer, OcError } from "@/lib/oc-server";
import { OPENCODE_BASE_URL } from "@/lib/opencode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthMethod = { type?: unknown };
type AuthorizationResponse = {
  url?: unknown;
  method?: unknown;
  instructions?: unknown;
};

function isOAuth(method: AuthMethod | undefined): boolean {
  return method?.type === "oauth";
}

function isAllowedAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return /(^|\.)anthropic\.com$|(^|\.)claude\.ai$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as
    | { method?: unknown }
    | undefined;
  const methodIndex = body?.method;
  if (!Number.isInteger(methodIndex) || (methodIndex as number) < 0) {
    return NextResponse.json({ error: "認証方式を指定してください" }, { status: 400 });
  }

  try {
    const methods = await ocServer<Record<string, AuthMethod[]>>(null, "/provider/auth");
    const selected = methods.anthropic?.[methodIndex as number];
    if (!isOAuth(selected)) {
      return NextResponse.json(
        { error: "Claude のOAuth認証方式が見つかりません" },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      new URL("/provider/anthropic/oauth/authorize", OPENCODE_BASE_URL),
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
      return NextResponse.json({ error: "Claudeの認証を開始できません" }, { status: upstream.status });
    }
    if (
      !isAllowedAuthorizationUrl(result?.url) ||
      (result.method !== "auto" && result.method !== "code")
    ) {
      return NextResponse.json({ error: "Claudeから不正な認証情報が返されました" }, { status: 502 });
    }
    return NextResponse.json({
      url: result.url,
      method: result.method,
      instructions: typeof result.instructions === "string" ? result.instructions : undefined,
    });
  } catch (error) {
    if (error instanceof OcError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Claudeの認証を開始できません" }, { status: 503 });
  }
}
