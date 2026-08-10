import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getOllamaStatus } from "@/lib/ollama-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const status = await getOllamaStatus();
  return NextResponse.json(status);
}