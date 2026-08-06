import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import {
  extensionsErrorResponse,
  parseEnabledBody,
  parsePluginBody,
} from "@/lib/opencode-extensions/http";
import {
  deleteDisabledConfiguredPlugin,
  setPluginEnabled,
  updateConfiguredPlugin,
} from "@/lib/opencode-extensions/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest,
  context: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const body = await req.json().catch(() => undefined);
  const parsed = parseEnabledBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await setPluginEnabled(id, parsed.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err);
  }
}

export async function PUT(req: NextRequest,
  context: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  const body = await req.json().catch(() => undefined);
  const parsed = parsePluginBody(body);
  if ("error" in parsed) return parsed.error;
  try {
    await updateConfiguredPlugin(id, parsed);
    return NextResponse.json({ ok: true, requiresRestart: true });
  } catch (err) {
    return extensionsErrorResponse(err, "プラグインを更新できません");
  }
}

/** Permanently remove a disabled plugin's WebUI-local restore record. */
export async function DELETE(req: NextRequest,
  context: { params: Promise<{ id: string }> },) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    await deleteDisabledConfiguredPlugin(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return extensionsErrorResponse(err, "無効なプラグインの状態を削除できません");
  }
}
