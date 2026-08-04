/**
 * Smoke: cursor-acp proxy health + image materialization for Auto vision path.
 */
import assert from "node:assert/strict"
import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const { materializeDataUrlImage, formatContentPartsForPrompt } = await import(
  pathToFileURL(path.join(here, "image-attachments.mjs")).href
)

function get(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let d = ""
      res.on("data", (c) => (d += c))
      res.on("end", () => resolve({ status: res.statusCode, body: d }))
    })
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("timeout"))
    })
  })
}

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-acp-img-"))
const saved = materializeDataUrlImage(png, tmp)
assert.ok(saved && fs.existsSync(saved), "materializeDataUrlImage should write a file")

const parts = formatContentPartsForPrompt(
  [{ type: "text", text: "what color?" }, { type: "image_url", image_url: { url: png } }],
  tmp,
)
assert.ok(parts.some((p) => p.includes("Attached image saved to:")))
assert.ok(parts.some((p) => p.includes("Read tool")))

// Live proxy: prefer healthy 32125, never accept hung 32124 as success.
let healthy = null
for (const port of [32125, 32124]) {
  try {
    const r = await get(`http://127.0.0.1:${port}/health`, 2500)
    if (r.status === 200 && r.body.includes('"ok":true')) {
      healthy = port
      break
    }
  } catch {
    // try next
  }
}
assert.ok(healthy != null, "no healthy cursor-acp proxy on 32124/32125")
assert.notEqual(healthy, 32124, "must not treat hung 32124 as healthy")
console.log("cursor-acp image+proxy smoke OK", { healthy, saved })
