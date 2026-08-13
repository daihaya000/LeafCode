import { NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { isQwenNativeVisionAvailable } from "@/lib/qwen-native-vision";
import { withReadCache } from "@/lib/http-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  return withReadCache(
    NextResponse.json({ nativeAvailable: isQwenNativeVisionAvailable() }),
    { maxAge: 60 },
  );
}
