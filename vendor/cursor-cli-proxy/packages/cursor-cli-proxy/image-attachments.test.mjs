import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const { materializeDataUrlImage, formatContentPartsForPrompt } = await import(
  pathToFileURL(path.join(here, "image-attachments.mjs")).href
)

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-att-"))
const dir = path.join(tmp, ".opencode-cursor-attachments")
fs.mkdirSync(dir, { recursive: true })

// Pre-existing dir must not throw (OneDrive/Windows EEXIST case).
const saved = materializeDataUrlImage(png, tmp)
assert.ok(saved && fs.existsSync(saved))
assert.equal(materializeDataUrlImage(png, tmp), saved)

const parts = formatContentPartsForPrompt(
  [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: png } }],
  tmp,
)
assert.ok(parts[0] === "see")
assert.match(parts[1], /Attached image saved to:/)
assert.match(parts[1], /Read tool/)

console.log("image-attachments unit OK")
