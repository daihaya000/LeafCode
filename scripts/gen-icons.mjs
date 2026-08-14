// Generates every branded icon from the source artwork icon/LeafCode.png
// (512x512): the tray ICO (host/src/icon.json), PWA PNGs (web/public/),
// the Next.js favicon (web/src/app/favicon.ico) and the Browser Bridge
// extension icons (browser-bridge/extension/icons/).
// Usage: node scripts/gen-icons.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// sharp ships as an optional dependency of next inside web/; resolve it from
// there so this script has no dependency of its own.
const require = createRequire(join(ROOT, "web", "package.json"));
const sharp = require("sharp");

const SOURCE = join(ROOT, "icon", "LeafCode.png");

/** Load the source artwork, resized to size×size, as top-down RGBA bytes. */
async function renderRgba(size) {
  return sharp(SOURCE).resize(size, size).raw().toBuffer();
}

// ---- ICO (32bpp BMP entries, bottom-up BGRA + AND mask) ----
function icoEntry(size, rgba) {
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4 + maskRowBytes * size, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4;
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2]; // B
      pixels[d + 1] = rgba[s + 1]; // G
      pixels[d + 2] = rgba[s]; // R
      pixels[d + 3] = rgba[s + 3]; // A
    }
  }
  const mask = Buffer.alloc(maskRowBytes * size, 0);
  return Buffer.concat([header, pixels, mask]);
}

function buildIco(sizes, rgbaBySize) {
  const entries = sizes.map((s) => ({ size: s, data: icoEntry(s, rgbaBySize.get(s)) }));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dirEntries = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...dirEntries, ...entries.map((e) => e.data)]);
}

async function main() {
  const sizes = [16, 32, 48, 128, 180, 192, 512];
  const rgbaBySize = new Map();
  for (const s of sizes) rgbaBySize.set(s, await renderRgba(s));

  // Tray icon: 16/32 ICO, embedded as base64 in host/src/icon.json.
  const ico = buildIco([16, 32], rgbaBySize);
  writeFileSync(
    join(ROOT, "host", "src", "icon.json"),
    JSON.stringify({ base64: ico.toString("base64") }) + "\n",
  );

  // Next.js favicon (app router serves web/src/app/favicon.ico).
  writeFileSync(join(ROOT, "web", "src", "app", "favicon.ico"), buildIco([16, 32], rgbaBySize));

  // PWA icons.
  for (const s of [192, 512]) {
    await sharp(SOURCE).resize(s, s).png().toFile(join(ROOT, "web", "public", `icon-${s}.png`));
  }
  await sharp(SOURCE).resize(180, 180).png().toFile(join(ROOT, "web", "public", "apple-touch-icon.png"));

  // Browser Bridge extension icons.
  for (const s of [16, 32, 48, 128]) {
    await sharp(SOURCE).resize(s, s).png().toFile(join(ROOT, "browser-bridge", "extension", "icons", `icon-${s}.png`));
  }

  console.log("Generated icons from", SOURCE);
}

main().catch((error) => {
  console.error("Icon generation failed:", error);
  process.exitCode = 1;
});
