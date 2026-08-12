import fs from "node:fs";
import path from "node:path";

function isPathOrDescendant(candidate: string, parent: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedParent = parent.toLowerCase();
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(normalizedParent + path.sep)
  );
}

function isWindowsDriveRoot(candidate: string): boolean {
  return /^[A-Za-z]:\\?$/.test(candidate);
}

function isNetworkOrDevicePath(candidate: string): boolean {
  return /^\\\\(?:[?.]\\|[^\\]+\\[^\\]+)/.test(candidate);
}

type ProtectedPath = {
  path: string;
  includesDescendants: boolean;
};

function canonicalizeExistingPath(configuredPath: string | undefined): string | null {
  if (!configuredPath) return null;
  try {
    return fs.realpathSync.native(path.resolve(configuredPath));
  } catch {
    return null;
  }
}

/**
 * Resolve protected OS locations and local user profile roots.
 * The current user's own profile root is protected, while descendants can still
 * be added explicitly so normal workspace directories under the profile work.
 */
function getProtectedPaths(): ProtectedPath[] {
  const configuredPaths = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramW6432,
    process.env.ProgramData,
  ];
  const protectedPaths: ProtectedPath[] = configuredPaths.flatMap(
    (configuredPath) => {
      const canonicalPath = canonicalizeExistingPath(configuredPath);
      return canonicalPath
        ? [{ path: canonicalPath, includesDescendants: true }]
        : [];
    },
  );
  const ownProfile = canonicalizeExistingPath(process.env.USERPROFILE);
  const profileParent = canonicalizeExistingPath(
    process.env.USERPROFILE && path.dirname(process.env.USERPROFILE),
  );

  if (!profileParent) return protectedPaths;
  protectedPaths.push({ path: profileParent, includesDescendants: false });
  if (ownProfile) {
    // The current user's own profile root is protected, while descendants can
    // still be added explicitly so normal workspace directories under the
    // profile work (e.g. C:\Users\me\projects\repo).
    protectedPaths.push({ path: ownProfile, includesDescendants: false });
  }
  try {
    for (const entry of fs.readdirSync(profileParent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profilePath = canonicalizeExistingPath(path.join(profileParent, entry.name));
      if (!profilePath) continue;
      if (ownProfile && profilePath.toLowerCase() === ownProfile.toLowerCase()) {
        continue;
      }
      // Other users' profiles are fully protected including descendants: an
      // operator who can read them (e.g. an admin account) must not be able
      // to allowlist C:\Users\<other>\AppData etc. via the WebUI.
      protectedPaths.push({ path: profilePath, includesDescendants: true });
    }
  } catch {
    // Keep the parent root protected if profile enumeration is unavailable.
  }

  return protectedPaths;
}

/** Validate and return the canonical path for an existing allowlist directory. */
export function resolveValidatedAllowlistPath(
  rawPath: string,
): { canonicalPath: string } | { error: string } {
  if (!rawPath || typeof rawPath !== "string") return { error: "path is required" };

  const resolved = path.resolve(rawPath);
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync.native(resolved);
  } catch {
    return { error: "パスが存在しません" };
  }

  if (isNetworkOrDevicePath(canonicalPath)) {
    return { error: "UNCまたはデバイスパスは許可リストに追加できません" };
  }

  try {
    if (!fs.statSync(canonicalPath).isDirectory()) {
      return { error: "ディレクトリではありません" };
    }
  } catch {
    return { error: "パスの検証に失敗しました" };
  }

  if (isWindowsDriveRoot(canonicalPath)) {
    return { error: "ドライブルートは許可リストに追加できません" };
  }

  for (const protectedPath of getProtectedPaths()) {
    const isProtected = protectedPath.includesDescendants
      ? isPathOrDescendant(canonicalPath, protectedPath.path)
      : canonicalPath.toLowerCase() === protectedPath.path.toLowerCase();
    if (isProtected) {
      return {
        error: `${protectedPath.path} はシステム領域のため許可リストに追加できません`,
      };
    }
  }

  return { canonicalPath };
}

/** Backward-compatible validation helper for callers that only need an error. */
export function validateAllowlistPath(rawPath: string): string | null {
  const result = resolveValidatedAllowlistPath(rawPath);
  return "error" in result ? result.error : null;
}
