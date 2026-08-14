import os from "node:os";
import path from "node:path";
import { dataDir, legacyDataDir } from "../paths";

/**
 * The global OpenCode config link we swap: always `~/.config/opencode`.
 *
 * Deliberately ignores `OPENCODE_CONFIG_DIR`. The existing `opencodeConfigDir()`
 * honours that override so callers read the right files, but the *link* we
 * repoint must never move — swapping some env-provided path would silently
 * corrupt an unrelated directory.
 */
export function globalConfigLinkPath(): string {
  return path.join(os.homedir(), ".config", "opencode");
}

/**
 * Rewrite a recorded profile path that still points at the pre-rebrand data
 * directory (e.g. a registry written before `%APPDATA%\opencode-webui` was
 * renamed to `%APPDATA%\leafcode`) to the new location. The data-dir
 * migration renames the whole tree, so the relative suffix under the legacy
 * data dir is preserved under the new one. External profiles (user-picked
 * paths, `external: true`) are intentionally left alone — they may point at a
 * real directory that must keep working unchanged.
 */
export function normalizeProfilePath(p: string): string {
  const legacy = path.resolve(legacyDataDir());
  const resolved = path.resolve(p);
  if (isInside(legacy, resolved)) {
    const rel = path.relative(legacy, resolved);
    return path.join(dataDir(), rel);
  }
  return p;
}

/** Root holding every WebUI-managed profile directory. */
export function profilesRoot(): string {
  return path.join(dataDir(), "profiles");
}

/** Registry file (display names + paths only, never secrets). */
export function profilesStatePath(): string {
  return path.join(dataDir(), "profiles.json");
}

/** Prefix for the temporary junction used during a near-atomic swap. */
export const SWAP_LINK_PREFIX = "opencode.swap-";

/** Prefix for an in-progress copy that has not been published yet. */
export const PENDING_COPY_PREFIX = ".copying-";

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export const MAX_PROFILE_NAME_LENGTH = 64;

/**
 * Validate a user-supplied display label. The label never reaches the
 * filesystem (the directory uses a slug), but it is still bounded and
 * stripped of control characters.
 */
export function isValidProfileName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROFILE_NAME_LENGTH) return false;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  return true;
}

/**
 * Derive a filesystem-safe directory name from a display label.
 *
 * Non-ASCII labels (e.g. Japanese) legitimately collapse to nothing, so the
 * result falls back to `profile` rather than failing. Path separators, `..`
 * and Windows device names can never survive this.
 */
export function toSlug(name: string): string {
  const base = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 48)
    .replace(/^[-.]+|[-.]+$/g, "");

  if (!base) return "profile";
  if (WINDOWS_RESERVED.has(base.split(".")[0])) return `profile-${base}`;
  return base;
}

/** Pick a slug that is not already taken, appending `-2`, `-3`, ... */
export function resolveSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (s) => s.toLowerCase()));
  const base = toSlug(name);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("プロファイル名の候補が尽きました");
}

/** Case-insensitive path comparison (Windows paths are not case sensitive). */
export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** True when `child` resolves inside `parent` (used to keep writes in profilesRoot). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
