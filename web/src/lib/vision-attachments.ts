/**
 * Display-only store for images consumed by the vision pre-analysis path.
 *
 * When the answering model has no vision support, `rewriteNativeRequest` drops
 * the image parts before the prompt reaches OpenCode, so the engine transcript
 * has nothing to render and the attachment disappears from the timeline. The
 * bytes are copied here first and referenced by content hash from the injected
 * analysis block, which keeps the thumbnail available across reloads without
 * ever sending the image to a model that cannot read it.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

/**
 * Extensions are part of the on-disk name so the served Content-Type is
 * recovered without a sidecar file or a DB row. Only formats that are safe to
 * hand back to the browser as-is are stored — `image/svg+xml` is script-capable
 * and is deliberately absent.
 */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]),
);

/** Content hash, hex sha-256. Also the guard against `..` in served ids. */
const ID_RE = /^[a-f0-9]{64}$/;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

function attachmentsDir(): string {
  return path.join(dataDir(), "vision-attachments");
}

export function isVisionAttachmentId(id: string): boolean {
  return ID_RE.test(id);
}

/** Drops attachments past the retention window; at most once per hour. */
function pruneExpired(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  let entries: string[];
  try {
    entries = fs.readdirSync(attachmentsDir());
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(attachmentsDir(), entry);
    try {
      if (now - fs.statSync(file).mtimeMs > RETENTION_MS) fs.rmSync(file);
    } catch {
      // Concurrent prune or a locked file: skip, the next pass retries.
    }
  }
}

/**
 * Persists one `data:` URL and returns its content-hash id, or null when the
 * format is not renderable. Never throws — losing a thumbnail must not fail
 * the send.
 */
export function saveVisionAttachment(dataUrl: string, mime: string): string | null {
  const ext = MIME_TO_EXT[mime.toLowerCase()];
  if (!ext) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
    if (bytes.length === 0) return null;
    const id = createHash("sha256").update(bytes).digest("hex");
    const dir = attachmentsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${ext}`);
    // Content-addressed: an existing file has identical bytes. Re-stamp it so
    // a re-sent image is not pruned on the original send's clock.
    if (fs.existsSync(file)) {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } else {
      fs.writeFileSync(file, bytes);
    }
    pruneExpired(Date.now());
    return id;
  } catch {
    return null;
  }
}

export type VisionAttachment = { bytes: Buffer; mime: string };

/** Reads a stored attachment by id, or null when unknown/expired. */
export function readVisionAttachment(id: string): VisionAttachment | null {
  if (!isVisionAttachmentId(id)) return null;
  for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
    const file = path.join(attachmentsDir(), `${id}.${ext}`);
    try {
      return { bytes: fs.readFileSync(file), mime };
    } catch {
      // Try the next known extension.
    }
  }
  return null;
}

/** Test helper — allows the next `saveVisionAttachment` to prune again. */
export function __resetVisionAttachmentPruneForTest(): void {
  lastPruneAt = 0;
}
