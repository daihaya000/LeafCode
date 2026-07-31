import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProductionDistDir } from "../../scripts/web-dist-dir.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..");
const TSCONFIG_PATH = join(WEB_DIR, "tsconfig.json");

/**
 * Next.js rewrites tsconfig.json `include` during the build to add the
 * generated app-types directory (`distDir/types/all.ts`). When distDir points
 * outside the repo (default: %APPDATA%\opencode-webui\web-build), Next.js 15/16
 * writes an absolute Windows path into include. That makes the tsconfig
 * machine-specific and can break type checking on other machines or when the
 * build output is moved.
 *
 * This script removes any absolute-path includes that resolve inside the
 * production distDir, and rewrites them as the stable relative path
 * `.next/types/all.ts` (the conventional in-repo location) when the project
 * actually uses an external distDir. The relative path is harmless: when the
 * distDir is external, Next.js already generated the types there and tsc will
 * not re-resolve `.next/types` because the include does not exist; when the
 * distDir is in-repo `.next`, the relative path is correct.
 *
 * Run as `postbuild` so `next build` can update the file, then we immediately
 * clean it up before the change is committed accidentally.
 */
export async function cleanTsconfigIncludes(options = {}) {
  const read = options.read ?? readFile;
  const write = options.write ?? writeFile;
  const tsconfigPath = options.tsconfigPath ?? TSCONFIG_PATH;
  const webDir = options.webDir ?? WEB_DIR;
  const distDir = options.distDir ?? resolveProductionDistDir(process.env, webDir);

  const raw = await read(tsconfigPath, "utf8");
  const config = JSON.parse(raw);
  if (!Array.isArray(config.include)) return { changed: false };

  const normalizedDistDir = resolve(distDir).toLowerCase();
  const cleaned = [];
  let changed = false;

  for (const entry of config.include) {
    if (typeof entry !== "string") {
      cleaned.push(entry);
      continue;
    }
    const resolved = resolve(webDir, entry);
    const lowerResolved = resolved.toLowerCase();
    const isTypeGenDir = lowerResolved.endsWith("\\types\\**\\*.ts") || lowerResolved.endsWith("/types/**/*.ts");
    if (isAbsolutePathEntry(entry) && isTypeGenDir && isInsideOrEqual(lowerResolved, normalizedDistDir)) {
      if (!cleaned.includes(".next/types/**/*.ts")) {
        cleaned.push(".next/types/**/*.ts");
        changed = true;
      } else {
        changed = true;
      }
      continue;
    }
    cleaned.push(entry);
  }

  if (changed) {
    config.include = cleaned;
    await write(tsconfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }
  return { changed };
}

/**
 * True for entries that are machine-specific: either already an absolute
 * path, or a relative path that escapes the web dir with a leading ".."
 * segment (e.g. "..(5x)..\AppData\Roaming\opencode-webui\web-build\types\
 * all files under it", which is what Next.js 15/16 actually writes when
 * distDir is external -- it is syntactically relative, but not portable).
 * Combined with the isTypeGenDir + isInsideOrEqual(distDir) checks at each
 * call site, this only flags entries that both look like this and resolve
 * inside the configured distDir, so normal in-repo entries (the standard
 * ".next" types glob) are never touched.
 */
function isAbsolutePathEntry(entry) {
  if (/^[a-zA-Z]:[\\\/]/.test(entry)) return true;
  if (entry.startsWith("/") || entry.startsWith("\\")) return true;
  if (/^[\\\/]/.test(entry)) return true;
  return /^\.\.[\\\/]/.test(entry);
}

function isInsideOrEqual(child, parent) {
  return child === parent || child.startsWith(parent + "\\") || child.startsWith(parent + "/");
}

export async function detectAbsoluteDistIncludes(options = {}) {
  const read = options.read ?? readFile;
  const tsconfigPath = options.tsconfigPath ?? TSCONFIG_PATH;
  const webDir = options.webDir ?? WEB_DIR;
  const distDir = options.distDir ?? resolveProductionDistDir(process.env, webDir);

  const raw = await read(tsconfigPath, "utf8");
  const config = JSON.parse(raw);
  if (!Array.isArray(config.include)) return [];

  const normalizedDistDir = resolve(distDir).toLowerCase();
  const offenders = [];
  for (const entry of config.include) {
    if (typeof entry !== "string") continue;
    if (!isAbsolutePathEntry(entry)) continue;
    const resolved = resolve(webDir, entry).toLowerCase();
    const isTypeGenDir = resolved.endsWith("\\types\\**\\*.ts") || resolved.endsWith("/types/**/*.ts");
    if (isTypeGenDir && isInsideOrEqual(resolved, normalizedDistDir)) {
      offenders.push(entry);
    }
  }
  return offenders;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(join(__dirname, "verify-tsconfig.mjs"))) {
  // Auto-fix first (this runs as `postbuild`, right after `next build` may
  // have written a machine-specific distDir include), then verify: if
  // anything is still unresolved after cleaning, fail loudly instead of
  // silently leaving the file dirty.
  const { changed } = await cleanTsconfigIncludes();
  const offenders = await detectAbsoluteDistIncludes();
  if (offenders.length > 0) {
    console.error(
      "[verify-tsconfig] tsconfig.json includes machine-absolute paths to the production distDir:"
    );
    for (const p of offenders) console.error("  - " + p);
    process.exitCode = 1;
  } else if (changed) {
    console.log("[verify-tsconfig] tsconfig.json cleaned (removed machine-specific distDir include).");
  } else {
    console.log("[verify-tsconfig] tsconfig.json is clean.");
  }
}
