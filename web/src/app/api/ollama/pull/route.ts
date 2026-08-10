import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { pullOllamaModel } from "@/lib/ollama-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => undefined)) as
    | { model?: unknown }
    | undefined;
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json({ error: "model name is required" }, { status: 400 });
  }
  try {
    await pullOllamaModel(model);
    return NextResponse.json({ ok: true, model });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ollama pull failed" },
      { status: 500 },
    );
  }
}