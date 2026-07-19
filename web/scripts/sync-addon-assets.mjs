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
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[sync-addon-assets] ${name}: ${src} -> ${dest}`);
}
