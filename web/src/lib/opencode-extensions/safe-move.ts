import fs from "node:fs";
import path from "node:path";

/** Error class with a machine-readable code; `message` is user-safe Japanese. */
export type ExtensionsErrorCode =
  | "invalid-name"
  | "not-found"
  | "conflict"
  | "io"
  | "config";

export class ExtensionsError extends Error {
  code: ExtensionsErrorCode;
  constructor(code: ExtensionsErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function httpStatusFromCode(code: ExtensionsErrorCode): number {
  switch (code) {
    case "invalid-name":
      return 400;
    case "not-found":
      return 404;
    case "conflict":
      return 409;
    default:
      return 500;
  }
}

// Windows device names that can never be file/directory entries.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * Validate a single directory/file entry name supplied by the client.
 *
 * Only names that are one plain path segment are accepted: no separators,
 * no `..`, no leading dot, no control characters, no Windows-forbidden or
 * reserved names. Callers still re-resolve and re-contain the result.
 */
export function assertValidEntryName(name: unknown): asserts name is string {
  if (typeof name !== "string") {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  if (name.length === 0 || name.length > 255) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  if (name === "." || name === "..") {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  if (name.startsWith(".")) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  // Control chars and characters Windows forbids in entry names (incl. / \).
  if (/[\x00-\x1f\\/:*?"<>|]/.test(name)) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  // Windows dislikes trailing dots/spaces in entry names.
  if (/[. ]$/.test(name)) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  if (WINDOWS_RESERVED.test(name)) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
}

/**
 * Resolve `parent/name` and prove the result stays directly inside `parent`.
 * Defense in depth on top of `assertValidEntryName`: even a name that slips
 * past validation cannot escape the parent directory.
 */
export function resolveContainedPath(parent: string, name: string): string {
  assertValidEntryName(name);
  const resolvedParent = path.resolve(parent);
  const target = path.resolve(resolvedParent, name);
  if (path.dirname(target) !== resolvedParent) {
    throw new ExtensionsError("invalid-name", "名前が不正です");
  }
  return target;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a directory or file from `from` to `to` without data loss.
 *
 * - Fails with `conflict` (source untouched) when `to` already exists.
 * - Uses `rename` (atomic on one volume). `EEXIST`/`ENOTEMPTY` from a racing
 *   create is reported as `conflict` — rename never overwrites a non-empty
 *   directory, so the source and target both survive.
 * - Cross-volume (`EXDEV`) falls back to copy + remove; on copy failure the
 *   partial copy is rolled back and the source is kept.
 */
export async function moveEntrySafe(
  from: string,
  to: string,
  kind: "dir" | "file",
): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(from);
  } catch {
    throw new ExtensionsError("not-found", "移動対象が見つかりません");
  }
  const matches = kind === "dir" ? stat.isDirectory() : stat.isFile();
  if (!matches) {
    throw new ExtensionsError("not-found", "移動対象が見つかりません");
  }

  if (await pathExists(to)) {
    throw new ExtensionsError(
      "conflict",
      "移動先に同名の項目が既に存在します。手動で確認してから再実行してください",
    );
  }

  await fs.promises.mkdir(path.dirname(to), { recursive: true });

  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EISDIR") {
      throw new ExtensionsError(
        "conflict",
        "移動先に同名の項目が既に存在します。手動で確認してから再実行してください",
      );
    }
    if (code !== "EXDEV") {
      throw new ExtensionsError("io", "移動に失敗しました。元の場所は保持されています");
    }
    // Cross-volume: best-effort copy + remove (atomic rename is impossible).
    try {
      if (kind === "dir") {
        await fs.promises.cp(from, to, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } else {
        await fs.promises.copyFile(from, to);
      }
    } catch {
      await fs.promises.rm(to, { recursive: true, force: true }).catch(() => undefined);
      throw new ExtensionsError("io", "移動に失敗しました。元の場所は保持されています");
    }
    try {
      await fs.promises.rm(from, { recursive: true, force: true });
    } catch {
      // Source removal failed: the entry now exists in both places. The
      // original is preserved; the next toggle will report the conflict.
      throw new ExtensionsError(
        "conflict",
        "コピーは完了しましたが元の削除に失敗しました。元の場所に残っています",
      );
    }
  }
}
