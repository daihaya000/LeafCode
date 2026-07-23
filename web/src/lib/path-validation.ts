import fs from "node:fs";
import path from "node:path";

/** System and overly broad directories that must never be allowlisted. */
const FORBIDDEN_PREFIXES = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

function isPathOrDescendant(candidate: string, parent: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedParent = parent.toLowerCase();
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(normalizedParent + path.sep)
  );
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

  try {
    if (!fs.statSync(canonicalPath).isDirectory()) {
      return { error: "ディレクトリではありません" };
    }
  } catch {
    return { error: "パスの検証に失敗しました" };
  }

  if (/^[A-Za-z]:\\?$/.test(canonicalPath)) {
    return { error: "ドライブルートは許可リストに追加できません" };
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (isPathOrDescendant(canonicalPath, prefix)) {
      return { error: `${prefix} はシステム領域のため許可リストに追加できません` };
    }
  }

  const userProfile = process.env.USERPROFILE;
  if (
    userProfile &&
    canonicalPath.toLowerCase() === path.resolve(userProfile).toLowerCase()
  ) {
    return { error: "ユーザープロファイル直下は許可リストに追加できません" };
  }

  return { canonicalPath };
}

/** Backward-compatible validation helper for callers that only need an error. */
export function validateAllowlistPath(rawPath: string): string | null {
  const result = resolveValidatedAllowlistPath(rawPath);
  return "error" in result ? result.error : null;
}
