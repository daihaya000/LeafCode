import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { getOllamaStatus } from "@/lib/ollama-cli";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const status = await getOllamaStatus();
  return withReadCache(NextResponse.json(status), {
    maxAge: 30,
    staleWhileRevalidate: 300,
  });
}