import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { rejectUnlessLocal } from "@/lib/local-request";
import {
  CliLoginUnsupportedError,
  isCliLoginProvider,
  launchCliLogin,
} from "@/lib/cli-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/provider/cli-login — open a terminal running a CLI Proxy login.
 *
 * Host-only: the window appears on the host's desktop, so a remote client
 * could only spawn windows nobody is looking at (see `rejectUnlessLocal`).
 * The body names a provider; the executable comes from the fixed table in
 * `@/lib/cli-login`, never from the request.
 */
export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;
  const remote = rejectUnlessLocal(req);
  if (remote) return remote;

  const body = (await req.json().catch(() => undefined)) as
    | { provider?: unknown }
    | undefined;
  if (!isCliLoginProvider(body?.provider)) {
    return NextResponse.json(
      { error: "対応していないプロバイダーです" },
      { status: 400 },
    );
  }

  try {
    const result = launchCliLogin(body.provider);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    if (cause instanceof CliLoginUnsupportedError) {
      return NextResponse.json(
        { error: "この OS ではターミナルの自動起動に対応していません" },
        { status: 501 },
      );
    }
    return NextResponse.json(
      { error: "ターミナルを起動できませんでした" },
      { status: 500 },
    );
  }
}
