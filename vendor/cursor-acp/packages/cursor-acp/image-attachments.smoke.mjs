import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const text = readFileSync(join(root, "opencode.jsonc"), "utf8");
if (!text.includes('"attachment": true') || !text.includes('"modalities"') || !text.includes('"image"')) {
  console.error("opencode.jsonc missing cursor-acp/auto image modalities");
  process.exit(1);
}

const idx = readFileSync(join(here, "index.js"), "utf8");
for (const needle of [
  "image-attachments.mjs",
  "formatContentPartsForPrompt",
  "input.workspaceDirectory",
]) {
  if (!idx.includes(needle)) {
    console.error("index.js missing", needle);
    process.exit(1);
  }
}

const helpers = join(here, "image-attachments.mjs");
if (!existsSync(helpers)) {
  console.error("missing image-attachments.mjs");
  process.exit(1);
}
const helperText = readFileSync(helpers, "utf8");
for (const needle of ["materializeDataUrlImage", ".opencode-cursor-attachments"]) {
  if (!helperText.includes(needle)) {
    console.error("image-attachments.mjs missing", needle);
    process.exit(1);
  }
}

console.log("OK");
