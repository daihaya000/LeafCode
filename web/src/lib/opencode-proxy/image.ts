/**
 * Image-attachment guard for the BFF proxy (REFACTORING_PLAN P4-a).
 * Limits image parts in session-write bodies (count + per-image data-URL
 * size) so the proxy cannot be used to bypass the POST /api/tasks R28 limits.
 */

export type ImageAttachment = { mime: string; dataUrl: string };

/** Collect image attachments from v1 `parts` and v2 `prompt.files` shapes. */
export function collectImageAttachments(body: unknown): ImageAttachment[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const out: ImageAttachment[] = [];

  const pushImage = (mime: unknown, dataUrl: unknown) => {
    if (typeof mime !== "string" || !/^image\//i.test(mime)) return;
    out.push({
      mime,
      dataUrl: typeof dataUrl === "string" ? dataUrl : "",
    });
  };

  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const p = part as Record<string, unknown>;
      if (p.type !== "file") continue;
      pushImage(p.mime, typeof p.url === "string" ? p.url : p.uri);
    }
  }

  const prompt = record.prompt;
  if (prompt && typeof prompt === "object" && !Array.isArray(prompt)) {
    const files = (prompt as { files?: unknown }).files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (!file || typeof file !== "object" || Array.isArray(file)) continue;
        const f = file as Record<string, unknown>;
        pushImage(f.mime, typeof f.uri === "string" ? f.uri : f.url);
      }
    }
  }

  return out;
}

export function containsImagePart(body: unknown): boolean {
  return collectImageAttachments(body).length > 0;
}

// Match POST /api/tasks R28 limits so session write paths cannot bypass them.
export const MAX_IMAGE_COUNT = 10;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export function estimateDataUrlBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const b64 = uri.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** Returns false when image parts exceed count or per-image size limits. */
export function imagePartsWithinLimits(body: unknown): boolean {
  const images = collectImageAttachments(body);
  if (images.length === 0) return true;
  if (images.length > MAX_IMAGE_COUNT) return false;
  for (const image of images) {
    // Missing / non-data URLs cannot be size-checked — fail closed.
    if (!image.dataUrl || estimateDataUrlBytes(image.dataUrl) > MAX_IMAGE_SIZE_BYTES) {
      return false;
    }
  }
  return true;
}
