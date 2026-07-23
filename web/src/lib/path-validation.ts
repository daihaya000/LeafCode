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

/** Validate that a path is an existing directory outside protected areas. */
export function validateAllowlistPath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== "string") return "path is required";

  const resolved = path.resolve(rawPath);

  if (/^[A-Za-z]:\\?$/.test(resolved)) {
    return "ドライブルートは許可リストに追加できません";
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (isPathOrDescendant(resolved, prefix)) {
      return `${prefix} はシステム領域のため許可リストに追加できません`;
    }
  }

  const userProfile = process.env.USERPROFILE;
  if (userProfile && isPathOrDescendant(resolved, path.resolve(userProfile))) {
    if (resolved.toLowerCase() === path.resolve(userProfile).toLowerCase()) {
      return "ユーザープロファイル直下は許可リストに追加できません";
    }
  }

  try {
    if (!fs.existsSync(resolved)) return "パスが存在しません";
    if (!fs.lstatSync(resolved).isDirectory()) return "ディレクトリではありません";
  } catch {
    return "パスの検証に失敗しました";
  }

  return null;
}
