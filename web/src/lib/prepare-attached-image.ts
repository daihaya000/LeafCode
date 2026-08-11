/**
 * Browser-side resize/re-encode for composer image attachments.
 * Large phone photos stall send (JSON base64 + optional pre-analysis VL).
 */

export const PREPARE_IMAGE_MAX_EDGE = 1536;
/** Prefer staying under this decoded size before base64 (~1.2 MB on the wire). */
export const PREPARE_IMAGE_TARGET_BYTES = 900_000;
/** Skip re-encode when the original is already small enough on disk. */
export const PREPARE_IMAGE_SKIP_BYTES = 400_000;

export type PreparedAttachmentImage = {
  uri: string;
  mime: string;
  name?: string;
  preview: string;
};

function estimateDataUrlBytes(uri: string): number {
  const comma = uri.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const b64 = uri.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to HTMLImageElement (some containers / codecs).
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function sourceSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ("naturalWidth" in source && source.naturalWidth > 0) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * Downscale and JPEG-compress when the file is large or high-resolution.
 * Transparent PNGs become opaque JPEG (acceptable for analysis / most chats).
 * Falls back to the original data URL when canvas is unavailable or encode fails.
 */
export async function prepareAttachedImage(
  file: File,
  options?: { maxEdge?: number; targetBytes?: number; skipBytes?: number },
): Promise<PreparedAttachmentImage> {
  const maxEdge = options?.maxEdge ?? PREPARE_IMAGE_MAX_EDGE;
  const targetBytes = options?.targetBytes ?? PREPARE_IMAGE_TARGET_BYTES;
  const skipBytes = options?.skipBytes ?? PREPARE_IMAGE_SKIP_BYTES;
  const name = file.name || undefined;
  const originalMime = file.type || "image/png";

  const originalUri = await readFileAsDataUrl(file);
  const base: PreparedAttachmentImage = {
    uri: originalUri,
    mime: originalMime,
    ...(name ? { name } : {}),
    preview: originalUri,
  };

  if (typeof document === "undefined") return base;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await loadBitmap(file);
  } catch {
    return base;
  }

  try {
    const { width, height } = sourceSize(source);
    if (!width || !height) return base;

    const needsScale = Math.max(width, height) > maxEdge;
    const needsShrink = file.size > skipBytes || estimateDataUrlBytes(originalUri) > targetBytes;
    if (!needsScale && !needsShrink) return base;

    let outW = width;
    let outH = height;
    if (needsScale) {
      const scale = maxEdge / Math.max(width, height);
      outW = Math.max(1, Math.round(width * scale));
      outH = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return base;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(source, 0, 0, outW, outH);

    let quality = 0.82;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    // Progressive quality/size steps when still oversized.
    while (blob && blob.size > targetBytes && (quality > 0.5 || Math.max(outW, outH) > 640)) {
      if (quality > 0.5) {
        quality = Math.max(0.5, quality - 0.12);
      } else {
        outW = Math.max(1, Math.round(outW * 0.75));
        outH = Math.max(1, Math.round(outH * 0.75));
        canvas.width = outW;
        canvas.height = outH;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(source, 0, 0, outW, outH);
        quality = 0.75;
      }
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }

    if (!blob || blob.size <= 0) return base;
    // Prefer the original when re-encoding grew the payload (rare for photos).
    if (blob.size >= file.size && !needsScale) return base;

    const uri = await readFileAsDataUrl(blob);
    if (estimateDataUrlBytes(uri) >= estimateDataUrlBytes(originalUri) && !needsScale) {
      return base;
    }
    return {
      uri,
      mime: "image/jpeg",
      ...(name ? { name: name.replace(/\.[^.]+$/, "") + ".jpg" } : {}),
      preview: uri,
    };
  } finally {
    if (typeof (source as ImageBitmap).close === "function") {
      (source as ImageBitmap).close();
    }
  }
}
