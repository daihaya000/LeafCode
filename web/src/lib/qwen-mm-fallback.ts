import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const ATTACHMENTS_ROOT = "qwen-mm-attachments";
const DATA_URL_RE = /^data:([a-z0-9.+-]+\/([a-z0-9.+-]+));base64,([a-z0-9+/]+={0,2})$/i;
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

export type QwenMmImageInput = {
  dataUrl: string;
  mime: string;
  name?: string;
};

export function isQwenMmConnected(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const entry = (raw as Record<string, unknown>)["qwen-mm-plugins-core"];
  return Boolean(
    entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as { status?: unknown }).status === "connected",
  );
}

function extensionForMime(mime: string): string {
  const subtype = mime.toLowerCase().split("/")[1] ?? "png";
  if (subtype === "jpeg" || subtype === "jpg") return ".jpg";
  if (subtype === "svg+xml") return ".svg";
  if (subtype === "webp") return ".webp";
  if (subtype === "gif") return ".gif";
  return ".png";
}

function pruneOldAttachments(root: string): void {
  const cutoff = Date.now() - RETAIN_MS;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      if (fs.statSync(dir).mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } catch {
    // Attachment cleanup is best effort and must not block a prompt.
  }
}

export function persistQwenMmImages(
  images: readonly QwenMmImageInput[],
  sessionId: string,
): string[] {
  if (images.length === 0) return [];
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error("invalid session id for image fallback");
  }

  const root = path.join(dataDir(), ATTACHMENTS_ROOT);
  const sessionDir = path.join(root, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  pruneOldAttachments(root);

  return images.map((image) => {
    const match = DATA_URL_RE.exec(image.dataUrl);
    if (!match || match[1].toLowerCase() !== image.mime.toLowerCase()) {
      throw new Error("invalid image data for Qwen-MM fallback");
    }
    const filePath = path.join(sessionDir, `${randomUUID()}${extensionForMime(image.mime)}`);
    fs.writeFileSync(filePath, Buffer.from(match[3], "base64"), { mode: 0o600 });
    return filePath;
  });
}

export function qwenMmImageInstructions(
  prompt: string,
  imagePaths: readonly string[],
): string {
  const request = prompt.trim() || "ユーザーの依頼に沿って画像を確認してください。";
  const paths = imagePaths.map((filePath) => `- ${filePath}`).join("\n");
  return [
    request,
    "",
    "<qwen-mm-image-attachments>",
    "このモデルは画像を直接入力できないため、添付画像は接続済みの Qwen-MM-Plugins MCP で確認してください。",
    "まず vision_chat ツールを使い、images 引数へ以下の絶対パスを渡してください。画像内の文字が中心なら ocr も使ってください。",
    "ツールがエラーを返した場合は、画像を確認できたとは言わず、必要な API キーまたは MCP 設定が不足していると説明してください。",
    paths,
    "</qwen-mm-image-attachments>",
  ].join("\n");
}

function isImagePart(part: unknown): part is Record<string, unknown> {
  if (!part || typeof part !== "object" || Array.isArray(part)) return false;
  const value = part as Record<string, unknown>;
  return value.type === "file" && typeof value.mime === "string" && /^image\//i.test(value.mime);
}

function imageInputFromPart(part: Record<string, unknown>): QwenMmImageInput {
  const dataUrl = typeof part.url === "string" ? part.url : part.uri;
  return {
    dataUrl: typeof dataUrl === "string" ? dataUrl : "",
    mime: String(part.mime ?? ""),
    ...(typeof part.filename === "string" ? { name: part.filename } : {}),
  };
}

/** Replace image file parts with a text instruction for a text-only model. */
export function rewriteQwenMmRequest(
  body: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown> {
  const parts = Array.isArray(body.parts) ? body.parts : null;
  if (parts) {
    const imageParts = parts.filter(isImagePart);
    if (imageParts.length === 0) return body;
    const paths = persistQwenMmImages(imageParts.map(imageInputFromPart), sessionId);
    const nextParts = parts.filter((part) => !isImagePart(part));
    const textPart = nextParts.find(
      (part): part is Record<string, unknown> =>
        !!part && typeof part === "object" && !Array.isArray(part) &&
        (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string",
    );
    const instruction = qwenMmImageInstructions(
      typeof textPart?.text === "string" ? textPart.text : "",
      paths,
    );
    if (textPart) textPart.text = instruction;
    else nextParts.unshift({ type: "text", text: instruction });
    return { ...body, parts: nextParts };
  }

  const prompt = body.prompt;
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return body;
  const promptRecord = prompt as Record<string, unknown>;
  if (!Array.isArray(promptRecord.files)) return body;
  const imageFiles = promptRecord.files.filter((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return false;
    return typeof (file as Record<string, unknown>).mime === "string" &&
      /^image\//i.test((file as Record<string, unknown>).mime as string);
  }) as Record<string, unknown>[];
  if (imageFiles.length === 0) return body;
  const paths = persistQwenMmImages(
    imageFiles.map((file) => ({
      dataUrl: typeof file.uri === "string" ? file.uri : String(file.url ?? ""),
      mime: String(file.mime ?? ""),
      ...(typeof file.name === "string" ? { name: file.name } : {}),
    })),
    sessionId,
  );
  const text = typeof promptRecord.text === "string" ? promptRecord.text : "";
  return {
    ...body,
    prompt: {
      ...promptRecord,
      text: qwenMmImageInstructions(text, paths),
      files: promptRecord.files.filter((file) => !imageFiles.includes(file as Record<string, unknown>)),
    },
  };
}
