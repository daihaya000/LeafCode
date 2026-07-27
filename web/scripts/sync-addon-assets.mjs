/**
 * Copy each addon's `public/` tree into `web/public/addons/<name>/`
 * so Next.js can serve `/addons/<name>/…`.
 *
 * Source of truth: repo-root `addons/<name>/public/`
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addonsRoot = path.resolve(webDir, "..", "addons");
const outRoot = path.join(webDir, "public", "addons");

function listFiles(root, base = root, files = new Map()) {
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    const rel = path.relative(base, full).replaceAll(path.sep, "/");
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFiles(full, base, files);
      continue;
    }
    if (stat.isFile()) files.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return files;
}

function destinationIsCurrent(src, dest) {
  if (!existsSync(dest)) return false;
  const srcFiles = listFiles(src);
  const destFiles = listFiles(dest);
  if (srcFiles.size !== destFiles.size) return false;
  for (const [rel, srcStat] of srcFiles) {
    const destStat = destFiles.get(rel);
    if (!destStat) return false;
    if (srcStat.size !== destStat.size) return false;
    // cpSync does not need to preserve timestamps; a destination newer than the
    // source with the same size is treated as current. If the source is newer,
    // refresh the addon tree.
    if (srcStat.mtimeMs > destStat.mtimeMs + 1) return false;
  }
  return true;
}

if (!existsSync(addonsRoot)) {
  console.log("[sync-addon-assets] no addons/ directory; skip");
  process.exit(0);
}

mkdirSync(outRoot, { recursive: true });

for (const name of readdirSync(addonsRoot)) {
  if (name.startsWith(".")) continue;
  const addonDir = path.join(addonsRoot, name);
  if (!statSync(addonDir).isDirectory()) continue;
  const src = path.join(addonDir, "public");
  if (!existsSync(src) || !statSync(src).isDirectory()) continue;
  const dest = path.join(outRoot, name);
  if (destinationIsCurrent(src, dest)) {
    console.log(`[sync-addon-assets] ${name}: unchanged; skip`);
    continue;
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[sync-addon-assets] ${name}: ${src} -> ${dest}`);
}
