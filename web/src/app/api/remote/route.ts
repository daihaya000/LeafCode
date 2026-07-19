import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 3 placeholder: Remote Workspace attach is not implemented.
 * Contract reserved for future SSH / tunnel directory mounts.
 */
export async function GET() {
  return NextResponse.json({
    supported: false,
    modes: ["ssh", "tunnel"],
    message:
      "Remote Workspace is planned. Use VPN + local OpenCode serve for now.",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(
    {
      error: "remote workspace attach is not implemented",
      received: body,
      hint: "Connect via OpenVPN and open a local project path in the Launcher",
    },
    { status: 501 },
  );
}
