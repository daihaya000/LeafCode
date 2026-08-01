import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export function extensionForImageMime(mime) {
  const normalized = String(mime || "").toLowerCase()
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg"
  if (normalized === "image/webp") return ".webp"
  if (normalized === "image/gif") return ".gif"
  if (normalized === "image/png") return ".png"
  if (normalized === "image/svg+xml") return ".svg"
  return ".bin"
}

/** Persist a data: URL image under workspace/.opencode-cursor-attachments/ and return its path. */
export function materializeDataUrlImage(url, workspaceDirectory) {
  if (typeof url !== "string" || !workspaceDirectory) return null
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(url.trim())
  if (!match) return null
  const mime = match[1].toLowerCase()
  if (!mime.startsWith("image/")) return null
  let buffer
  try {
    buffer = Buffer.from(match[2], "base64")
  } catch {
    return null
  }
  if (!buffer.length) return null
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  const dir = path.join(workspaceDirectory, ".opencode-cursor-attachments")
  // OneDrive / Windows can throw EEXIST even with recursive:true when the
  // folder already exists (or is a cloud placeholder). Treat that as success.
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (err?.code !== "EEXIST") throw err
    try {
      if (!fs.statSync(dir).isDirectory()) throw err
    } catch {
      throw err
    }
  }
  const filePath = path.join(dir, `${hash}${extensionForImageMime(mime)}`)
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer)
    }
  } catch (err) {
    // Parallel requests for the same image can race on create; OK if present.
    if (err?.code !== "EEXIST" || !fs.existsSync(filePath)) throw err
  }
  return filePath
}

/** Convert OpenAI-style multimodal content parts into text lines for cursor-agent. */
export function formatContentPartsForPrompt(content, workspaceDirectory) {
  const textParts = []
  const imageNotes = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      textParts.push(part.text)
      continue
    }
    if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url
      const saved = materializeDataUrlImage(url, workspaceDirectory)
      if (saved) {
        imageNotes.push(
          `Attached image saved to: ${saved}\nUse the Read tool on that path to view the image contents.`,
        )
      } else if (typeof url === "string" && url.length > 0) {
        imageNotes.push(`Attached image URL (could not materialize locally): ${url.slice(0, 200)}`)
      }
      continue
    }
    if (part.type === "image" && typeof part.image === "string") {
      const dataUrl = part.image.startsWith("data:")
        ? part.image
        : `data:${part.mimeType || part.mediaType || "image/png"};base64,${part.image}`
      const saved = materializeDataUrlImage(dataUrl, workspaceDirectory)
      if (saved) {
        imageNotes.push(
          `Attached image saved to: ${saved}\nUse the Read tool on that path to view the image contents.`,
        )
      }
    }
  }
  return [...textParts, ...imageNotes]
}
