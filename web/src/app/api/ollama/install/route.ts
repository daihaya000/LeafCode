import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { installOllama, isOllamaInstalled } from "@/lib/ollama-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  try {
    if (isOllamaInstalled()) {
      return NextResponse.json({ installed: true, message: "Ollama is already installed" });
    }
    const result = await installOllama();
    return NextResponse.json(result, { status: result.installed ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { installed: false, message: err instanceof Error ? err.message : "Ollama install failed" },
      { status: 500 },
    );
  }
}