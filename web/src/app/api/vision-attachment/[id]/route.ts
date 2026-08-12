import { NextRequest, NextResponse } from "next/server";
import { requireAuthorized } from "@/lib/api-guard";
import { isVisionAttachmentId, readVisionAttachment } from "@/lib/vision-attachments";

export const runtime = "nodejs";

/**
 * Serves a display-only copy of an image that the vision pre-analysis stripped
 * from the prompt. Ids are content hashes, so the response is immutable and the
 * id itself is unguessable without the transcript that references it.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuthorized(req);
  if (denied) return denied;

  const { id } = await context.params;
  if (!isVisionAttachmentId(id)) {
    return NextResponse.json({ error: "invalid attachment id" }, { status: 400 });
  }
  const attachment = readVisionAttachment(id);
  if (!attachment) {
    return NextResponse.json({ error: "attachment not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(attachment.bytes), {
    headers: {
      "Content-Type": attachment.mime,
      "Content-Length": String(attachment.bytes.length),
      // Content-addressed: the bytes for an id never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      // The stored formats are raster-only, but keep the browser from sniffing
      // its way to an active content type anyway.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
