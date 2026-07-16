// Generates the tray ICO (host/src/icon.json) and PWA PNGs (web/public/)
// from one programmatic design: white ">_" prompt on an accent rounded square.
// Usage: node scripts/gen-icons.mjs
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x25, 0x63, 0xeb]; // accent blue
const FG = [0xff, 0xff, 0xff];

/** Signed distance helpers (unit square coordinates 0..1). */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return Math.hypot(x - cx, y - cy) <= r;
}

/** sample(u,v) → [r,g,b,a] with u,v in 0..1 */
function sample(u, v) {
  const pad = 0.04;
  const radius = 0.22;
  if (!inRoundedRect(u, v, pad, pad, 1 - pad, 1 - pad, radius)) {
    return [0, 0, 0, 0];
  }
  // glyph ">_"
  const stroke = 0.075;
  const chevron =
    segDist(u, v, 0.26, 0.3, 0.46, 0.48) <= stroke ||
    segDist(u, v, 0.46, 0.48, 0.26, 0.66) <= stroke;
  const underscore =
    u >= 0.52 && u <= 0.76 && v >= 0.6 && v <= 0.6 + stroke * 1.6;
  if (chevron || underscore) return [...FG, 255];
  return [...BG, 255];
}

/** Render RGBA buffer (top-down) with 4x4 supersampling. */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const [pr, pg, pb, pa] = sample(u, v);
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const idx = (y * size + x) * 4;
      buf[idx] = alpha > 0 ? Math.round(r / a) : 0;
      buf[idx + 1] = alpha > 0 ? Math.round(g / a) : 0;
      buf[idx + 2] = alpha > 0 ? Math.round(b / a) : 0;
      buf[idx + 3] = Math.round(alpha);
    }
  }
  return buf;
}

// ---- ICO (32bpp BMP entries, bottom-up BGRA + AND mask) ----
function icoEntry(size) {
  const rgba = render(size);
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

function buildIco(sizes) {
  const entries = sizes.map((s) => ({ size: s, data: icoEntry(s) }));
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

// ---- PNG encoder (RGBA, no interlace) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPng(size) {
  const rgba = render(size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const ico = buildIco([16, 32]);
writeFileSync(
  join(ROOT, "host", "src", "icon.json"),
  JSON.stringify({ base64: ico.toString("base64") }) + "\n",
);
writeFileSync(join(ROOT, "web", "public", "icon-192.png"), buildPng(192));
writeFileSync(join(ROOT, "web", "public", "icon-512.png"), buildPng(512));
writeFileSync(join(ROOT, "web", "public", "apple-touch-icon.png"), buildPng(180));
console.log(
  `icons generated: ico=${ico.length}B (16+32px), png 192/512/180`,
);
