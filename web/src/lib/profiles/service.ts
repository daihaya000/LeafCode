import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp, { statfs } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  computeDirSizeBytes,
  copyTree,
  countEntries,
  DUPLICATE_EXCLUDES,
  MIGRATE_EXCLUDES,
  verifyCopy,
} from "./copy";
import { isBusy, startJob } from "./jobs";
import { isValidProfileDir, removeLink, swapLink } from "./link";
import {
  isInside,
  isValidProfileName,
  PENDING_COPY_PREFIX,
  profilesRoot,
  resolveSlug,
  globalConfigLinkPath,
  samePath,
} from "./paths";
import {
  ensureRegistry,
  makeProfile,
  readState,
  resolveActiveId,
  writeState,
} from "./registry";
import type { LinkInfo, Profile, ProfileDto, ProfilesState } from "./types";
import { installWebUiDependencies, migrateProviderIds } from "./webui-dependencies";
import { readProfileSetupSettings } from "./settings";

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export type MigrationInfo = {
  needed: boolean;
  sourcePath: string;
  estimatedBytes: number;
};

export type ListResult = {
  profiles: ProfileDto[];
  activeId: string | null;
  linkState: LinkInfo["state"];
  canSwitch: boolean;
  reason?: string;
  migration?: MigrationInfo;
};

function switchBlockReason(link: LinkInfo): string | null {
  if (link.state === "realdir") {
    return "実体ディレクトリのため切り替えられません。手動で退避してから再実行してください。";
  }
  if (process.env.OPENCODE_CONFIG_DIR?.trim()) {
    return "OPENCODE_CONFIG_DIR が設定されているため、リンクの差し替えは反映されません。";
  }
  return null;
}

export async function listProfiles(): Promise<ListResult> {
  const { state, link } = ensureRegistry();

  const activeId = resolveActiveId(state, link);
  const reason = switchBlockReason(link) ?? undefined;

  const profiles: ProfileDto[] = state.profiles
    .map((p) => ({
      ...p,
      active: p.id === activeId,
      exists: dirExists(p.path),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active));

  // Best-effort one-shot migration of renamed provider keys across all
  // known profile config files (cursor-acp → cursor). Failures are swallowed
  // so a corrupt profile cannot brick the listing endpoint.
  for (const profile of state.profiles) {
    if (!dirExists(profile.path)) continue;
    try {
      migrateProviderIds(profile.path);
    } catch {
      /* best effort */
    }
  }

  // Migration is needed when the active profile lives outside profilesRoot.
  const activeProfile = state.profiles.find((p) => p.id === activeId);
  let migration: MigrationInfo | undefined;
  if (activeProfile?.external && dirExists(activeProfile.path)) {
    let estimatedBytes = 0;
    try {
      estimatedBytes = await computeDirSizeBytes(activeProfile.path);
    } catch {
      /* best effort */
    }
    migration = {
      needed: true,
      sourcePath: activeProfile.path,
      estimatedBytes,
    };
  } else if (link.state === "realdir" && isValidProfileDir(globalConfigLinkPath())) {
    // A legacy installation may still have the config as a real directory,
    // so it is not registered as a switchable profile yet. Offer migration
    // before requiring the user to create a junction manually.
    let estimatedBytes = 0;
    try {
      estimatedBytes = await computeDirSizeBytes(globalConfigLinkPath());
    } catch {
      /* best effort */
    }
    migration = {
      needed: true,
      sourcePath: globalConfigLinkPath(),
      estimatedBytes,
    };
  }

  return {
    profiles,
    activeId,
    linkState: link.state,
    canSwitch: reason === undefined && link.state === "link",
    reason,
    migration,
  };
}

function dirExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

export type ActivateError = { status: 409 | 500; error: string };

export function activate(id: string): { ok: true } | ActivateError {
  const { state, link } = ensureRegistry();

  const reason = switchBlockReason(link);
  if (reason) return { status: 409, error: reason };

  if (isBusy()) {
    return { status: 409, error: "別の処理が進行中です。完了してから再試行してください。" };
  }

  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) {
    return { status: 409, error: "プロファイルが見つかりません。" };
  }

  if (!dirExists(profile.path) || !isValidProfileDir(profile.path)) {
    return {
      status: 409,
      error: `${profile.path} は設定ディレクトリとして認識できません。`,
    };
  }

  try {
    swapLink(profile.path);
  } catch (err) {
    return {
      status: 409,
      error: err instanceof Error ? err.message : "切り替えに失敗しました。",
    };
  }

  // Update the cached activeId (the real link is already the source of truth).
  state.activeId = id;
  writeState(state);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// create / duplicate
// ---------------------------------------------------------------------------

export type CreateResult =
  | { kind: "created"; profile: ProfileDto }
  | { kind: "job"; jobId: string };

function findProfile(state: ProfilesState, id: string): Profile | undefined {
  return state.profiles.find((p) => p.id === id);
}

function registerProfile(state: ProfilesState, profile: Profile): void {
  state.profiles.push(profile);
  writeState(state);
}

export function createProfile(input: {
  name: string;
  from: "empty" | string;
}): CreateResult | ActivateError {
  if (!isValidProfileName(input.name)) {
    return { status: 409, error: "プロファイル名が不正です。" };
  }

  const { state, link } = ensureRegistry();
  const slug = resolveSlug(
    input.name,
    state.profiles.map((p) => path.basename(p.path)),
  );
  const dest = path.join(profilesRoot(), slug);

  if (input.from === "empty") {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, "opencode.jsonc"),
      '{\n  "$schema": "https://opencode.ai/config.json"\n}\n',
      "utf8",
    );
    installWebUiDependencies(dest, readProfileSetupSettings());
    const profile = makeProfile(input.name, dest);

    // On a completely new installation there is no config link to activate.
    // Do not replace a real directory or an existing external profile.
    const firstProfile = state.profiles.length === 0 && link.state === "missing";
    if (firstProfile) {
      try {
        swapLink(dest);
      } catch (error) {
        fs.rmSync(dest, { recursive: true, force: true });
        return {
          status: 409,
          error: error instanceof Error ? error.message : "プロファイルのリンク作成に失敗しました。",
        };
      }
      state.activeId = profile.id;
    }
    registerProfile(state, profile);
    return {
      kind: "created",
      profile: { ...profile, active: firstProfile, exists: true },
    };
  }

  // Duplicate from an existing profile.
  const source = findProfile(state, input.from);
  if (!source) {
    return { status: 409, error: "複製元のプロファイルが見つかりません。" };
  }
  if (!dirExists(source.path)) {
    return { status: 409, error: "複製元のプロファイルが存在しません。" };
  }
  if (isBusy()) {
    return { status: 409, error: "別の処理が進行中です。完了してから再試行してください。" };
  }

  const pendingDest = path.join(
    profilesRoot(),
    `${PENDING_COPY_PREFIX}${randomBytes(4).toString("hex")}`,
  );

  const job = startJob("duplicate", async (progress) => {
    const total = await countEntries(source.path, DUPLICATE_EXCLUDES);
    progress.setTotal(total);

    const result = await copyTree(source.path, pendingDest, {
      exclude: DUPLICATE_EXCLUDES,
      onProgress: progress.setCopied,
    });

    await verifyCopy(pendingDest, result.copied, total);
    installWebUiDependencies(pendingDest, readProfileSetupSettings());
    await fsp.rename(pendingDest, dest);

    const profile = makeProfile(input.name, dest);
    const freshState = readState();
    registerProfile(freshState, profile);

    return result.dereferenced
      ? "一部の symlink を実体コピーに置き換えました。"
      : undefined;
  });

  return { kind: "job", jobId: job.id };
}

export type InstallDependenciesResult = { ok: true; installed: string[] } | ActivateError;

export function installDependencies(id: string): InstallDependenciesResult {
  const { state } = ensureRegistry();
  const profile = findProfile(state, id);
  if (!profile) return { status: 409, error: "プロファイルが見つかりません。" };
  if (!dirExists(profile.path) || !isValidProfileDir(profile.path)) {
    return { status: 409, error: `${profile.path} は設定ディレクトリとして認識できません。` };
  }
  try {
    return { ok: true, installed: installWebUiDependencies(profile.path, readProfileSetupSettings()) };
  } catch (error) {
    return { status: 409, error: error instanceof Error ? error.message : "LeafCode依存の適用に失敗しました。" };
  }
}

export type StartupInstallResult =
  | { ok: true; installed: string[]; skipped?: boolean }
  | { ok: false; error: string };

/**
 * WebUI 起動時にアクティブプロファイルへ連携依存を自動適用する。
 * 設定が OFF またはアクティブプロファイルが無い場合は何もせず `skipped` を返す。
 * 失敗しても起動を妨げない（呼び出し側は必ず捕捉する）。
 */
export function installDependenciesOnStartup(): StartupInstallResult {
  const settings = readProfileSetupSettings();
  if (!settings.autoInstallOnStartup) {
    return { ok: true, installed: [], skipped: true };
  }
  const { state, link } = ensureRegistry();
  const activeId = resolveActiveId(state, link);
  const active = state.profiles.find((p) => p.id === activeId);
  if (!active) return { ok: true, installed: [], skipped: true };
  if (!dirExists(active.path) || !isValidProfileDir(active.path)) {
    return { ok: false, error: `${active.path} は設定ディレクトリとして認識できません。` };
  }
  try {
    return { ok: true, installed: installWebUiDependencies(active.path, settings) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "LeafCode依存の適用に失敗しました。" };
  }
}

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

export type MigrateMode = "copy" | "move";
export type MigrateResult = { jobId: string } | ActivateError;

export function migrateDefault(mode: MigrateMode = "copy"): MigrateResult {
  const { state, link } = ensureRegistry();

  const realdirMigration = link.state === "realdir";
  if ((!realdirMigration && link.state !== "link") || (!realdirMigration && !link.target)) {
    return { status: 409, error: "リンクが存在しないため移行できません。" };
  }

  const activeId = resolveActiveId(state, link);
  const active = state.profiles.find((p) => p.id === activeId);
  const sourcePath = realdirMigration ? globalConfigLinkPath() : active?.path;
  if (!sourcePath || (!realdirMigration && !active?.external)) {
    return { status: 409, error: "移行対象のプロファイルが見つかりません。" };
  }
  if (!dirExists(sourcePath) || !isValidProfileDir(sourcePath)) {
    return { status: 409, error: "移行元が設定ディレクトリとして認識できません。" };
  }
  if (isBusy()) {
    return { status: 409, error: "別の処理が進行中です。完了してから再試行してください。" };
  }

  const sourceId = active?.id;
  const pendingDest = path.join(
    profilesRoot(),
    `${PENDING_COPY_PREFIX}${randomBytes(4).toString("hex")}`,
  );
  const finalDest = path.join(profilesRoot(), "default");

  const job = startJob("migrate", async (progress) => {
    // Disk space check: need source size + 20% headroom.
    const sourceBytes = await computeDirSizeBytes(sourcePath);
    try {
      const fsStats = await statfs(profilesRoot());
      const freeBytes = fsStats.bavail * fsStats.bsize;
      if (freeBytes < sourceBytes * 1.2) {
        throw new Error(
          `空き容量が不足しています（必要: 約 ${Math.ceil((sourceBytes * 1.2) / 1e6)} MB、空き: 約 ${Math.ceil(freeBytes / 1e6)} MB）。`,
        );
      }
    } catch (err) {
      // Re-throw our own error; swallow statfs failures (best effort).
      if (err instanceof Error && err.message.includes("空き容量")) throw err;
    }

    const total = await countEntries(sourcePath, MIGRATE_EXCLUDES);
    progress.setTotal(total);

    const result = await copyTree(sourcePath, pendingDest, {
      exclude: MIGRATE_EXCLUDES,
      onProgress: progress.setCopied,
    });

    await verifyCopy(pendingDest, result.copied, total);

    // Verify packages/ survived (needed for node_modules symlinks).
    try {
      await fsp.stat(path.join(pendingDest, "packages"));
    } catch {
      throw new Error("複製先に packages/ がありません。移行を中止しました。");
    }

    await fsp.rename(pendingDest, finalDest);

    // A real directory occupies the link path itself. Move it aside before
    // replacing the path with a junction, then restore it if the swap fails.
    let realdirBackupPath: string | undefined;
    if (realdirMigration) {
      realdirBackupPath = `${sourcePath}.migration-backup-${randomBytes(4).toString("hex")}`;
      await fsp.rename(sourcePath, realdirBackupPath);
    }
    try {
      swapLink(finalDest);
    } catch (error) {
      if (realdirBackupPath) {
        try {
          await fsp.rename(realdirBackupPath, sourcePath);
        } catch {
          /* preserve the error that caused the failed migration */
        }
      }
      throw error;
    }

    // Update registry: rename old default to a backup label, add new default.
    const freshState = readState();
    const oldEntry = sourceId
      ? freshState.profiles.find((p) => p.id === sourceId)
      : undefined;
    let sourceRemovalNote: string | undefined;
    let sourceRemoved = false;
    if (mode === "move") {
      try {
        // The link already points at finalDest, so removing the old target
        // cannot affect the active profile or follow the junction.
        await fsp.rm(realdirBackupPath ?? sourcePath, { recursive: true, force: false });
        sourceRemoved = true;
      } catch {
        sourceRemovalNote = "元のプロファイルを削除できなかったため、移行前バックアップとして残しました。";
      }
    }
    if (oldEntry && !sourceRemoved) {
      oldEntry.name = "default（移行前バックアップ）";
      oldEntry.external = true;
    } else if (oldEntry && sourceRemoved) {
      freshState.profiles = freshState.profiles.filter((p) => p.id !== sourceId);
    } else if (realdirBackupPath && !sourceRemoved) {
      freshState.profiles.push(makeProfile("default（移行前バックアップ）", realdirBackupPath));
    }
    const newProfile = makeProfile("default", finalDest);
    freshState.profiles.push(newProfile);
    freshState.activeId = newProfile.id;
    writeState(freshState);

    const notes = [
      result.dereferenced ? "一部の symlink を実体コピーに置き換えました。" : undefined,
      sourceRemovalNote,
    ].filter(Boolean);
    return notes.length > 0 ? notes.join(" ") : undefined;
  });

  return { jobId: job.id };
}

// ---------------------------------------------------------------------------
// rename / unregister
// ---------------------------------------------------------------------------

export function renameProfile(
  id: string,
  name: string,
): { ok: true } | ActivateError {
  if (!isValidProfileName(name)) {
    return { status: 409, error: "プロファイル名が不正です。" };
  }
  const trimmed = name.trim();
  const { state, link } = ensureRegistry();
  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) {
    return { status: 409, error: "プロファイルが見つかりません。" };
  }

  // Only managed profiles (inside profilesRoot) can be renamed on disk.
  // External profiles keep their original directory; only the label changes.
  if (isInside(profilesRoot(), profile.path) && fs.existsSync(profile.path)) {
    const linkPath = globalConfigLinkPath();
    const wasActive =
      link.state === "link" &&
      link.target !== null &&
      samePath(link.target, profile.path);
    const taken = new Set(
      state.profiles
        .filter((p) => p.id !== id)
        .map((p) => path.basename(p.path).toLowerCase()),
    );
    const slug = resolveSlug(trimmed, taken);
    if (slug.toLowerCase() !== path.basename(profile.path).toLowerCase()) {
      const newPath = path.join(profilesRoot(), slug);
      if (fs.existsSync(newPath)) {
        return { status: 409, error: "リネーム先のディレクトリが既に存在します。" };
      }

      // Windows refuses to rename a directory that is the target of an active
      // junction (EPERM). Detach the junction first, rename the directory, then
      // repoint the junction at the new path. On non-Windows or non-active
      // profiles the junction is simply not touched here.
      if (wasActive) {
        try {
          removeLink(linkPath);
        } catch (err) {
          return {
            status: 500,
            error: err instanceof Error ? err.message : "ジャンクションの削除に失敗しました。",
          };
        }
      }

      try {
        fs.renameSync(profile.path, newPath);
      } catch {
        // EPERM can happen when a process (e.g. opencode serve) holds a handle
        // inside the directory. Fall back to copy-then-delete, which operates
        // file-by-file and tolerates open handles on the source tree.
        try {
          fs.cpSync(profile.path, newPath, {
            recursive: true,
            force: true,
            errorOnExist: true,
          });
        } catch (copyErr) {
          // Restore the junction if we removed it but both rename and copy failed.
          if (wasActive) {
            try {
              fs.symlinkSync(profile.path, linkPath, "junction");
            } catch {
              /* best effort — the rename failure is the primary error */
            }
          }
          // Clean up a partial copy so a retry starts fresh.
          try {
            fs.rmSync(newPath, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          return {
            status: 500,
            error:
              copyErr instanceof Error
                ? copyErr.message
                : "ディレクトリのリネームに失敗しました。",
          };
        }
        // Copy succeeded; remove the old directory. This may fail if a handle
        // is still open, but the profile is already logically moved.
        try {
          fs.rmSync(profile.path, { recursive: true, force: true });
        } catch {
          /* best effort — leftover directory will be cleaned up on next start */
        }
      }
      profile.path = newPath;

      // When the active profile was renamed on disk, repoint the junction so
      // OpenCode keeps reading from the moved directory.
      if (wasActive) {
        try {
          swapLink(newPath);
        } catch (err) {
          return {
            status: 500,
            error: err instanceof Error ? err.message : "リンクの追従に失敗しました。",
          };
        }
      }
    }
  }

  profile.name = trimmed;
  writeState(state);
  return { ok: true };
}

/**
 * Move a profile directory to the OS trash / Recycle Bin, then drop it from the registry.
 *
 * On Windows, uses `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory`
 * with `SendToRecycleBin` via PowerShell — the same Win32 `SHFileOperation`
 * the shell uses, so the directory appears in Recycle Bin and is restorable.
 * On other platforms (or if the PowerShell call fails), falls back to
 * `fs.rm` recursive delete. The active profile is always refused.
 */
export async function deleteProfile(
  id: string,
): Promise<{ ok: true } | ActivateError> {
  const { state, link } = ensureRegistry();
  const activeId = resolveActiveId(state, link);
  if (id === activeId) {
    return { status: 409, error: "アクティブなプロファイルは削除できません。" };
  }
  const index = state.profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    return { status: 409, error: "プロファイルが見つかりません。" };
  }
  const [profile] = state.profiles.splice(index, 1);
  writeState(state);
  const moveErr = moveToTrash(profile.path);
  if (moveErr) {
    // Registry entry already removed; surface the filesystem failure so the
    // user knows the directory may still be on disk.
    return {
      status: 500,
      error: `一覧からは削除しましたがディレクトリをごみ箱へ移動できませんでした: ${moveErr}`,
    };
  }
  return { ok: true };
}

/**
 * Move a path to the OS trash. Returns an error string on failure, or null on
 * success. On Windows, uses the Recycle Bin via PowerShell; elsewhere, or if
 * the PowerShell call is unavailable, falls back to a permanent `fs.rm`.
 */
function moveToTrash(target: string): string | null {
  if (process.platform === "win32") {
    // Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory with
    // SendToRecycleBin is the managed wrapper over SHFileOperation and
    // sends the directory to the Recycle Bin (restorable, not permanent).
    const escaped = target.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.status === 0) return null;
    // Fall back to permanent delete if recycle is unavailable (e.g. path on
    // a network drive without a recycle bin). Better than leaving it on disk
    // after the registry entry is already gone.
    const permErr = permanentDelete(target);
    if (permErr === null) return null;
    const msg = (result.stderr || result.stdout || "").toString().trim();
    return permErr ?? (msg || "ごみ箱への移動に失敗しました");
  }
  return permanentDelete(target);
}

function permanentDelete(target: string): string | null {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return null;
  } catch (err) {
    return `ディレクトリの削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
  }
}
