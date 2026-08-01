import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp, { statfs } from "node:fs/promises";
import path from "node:path";
import {
  computeDirSizeBytes,
  copyTree,
  countEntries,
  DUPLICATE_EXCLUDES,
  MIGRATE_EXCLUDES,
  verifyCopy,
} from "./copy";
import { isBusy, startJob } from "./jobs";
import { isValidProfileDir, swapLink } from "./link";
import {
  isValidProfileName,
  PENDING_COPY_PREFIX,
  profilesRoot,
  resolveSlug,
} from "./paths";
import {
  ensureRegistry,
  makeProfile,
  readState,
  resolveActiveId,
  writeState,
} from "./registry";
import type { LinkInfo, Profile, ProfileDto, ProfilesState } from "./types";
import { installWebUiDependencies } from "./webui-dependencies";
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

  const profiles: ProfileDto[] = state.profiles.map((p) => ({
    ...p,
    active: p.id === activeId,
    exists: dirExists(p.path),
  }));

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

export type ActivateError = { status: 409; error: string };

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

  const { state } = ensureRegistry();
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
    registerProfile(state, profile);
    return {
      kind: "created",
      profile: { ...profile, active: false, exists: true },
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

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

export type MigrateResult = { jobId: string } | ActivateError;

export function migrateDefault(): MigrateResult {
  const { state, link } = ensureRegistry();

  if (link.state !== "link" || !link.target) {
    return { status: 409, error: "リンクが存在しないため移行できません。" };
  }

  const activeId = resolveActiveId(state, link);
  const active = state.profiles.find((p) => p.id === activeId);
  if (!active?.external) {
    return { status: 409, error: "移行対象のプロファイルが見つかりません。" };
  }
  if (!dirExists(active.path) || !isValidProfileDir(active.path)) {
    return { status: 409, error: "移行元が設定ディレクトリとして認識できません。" };
  }
  if (isBusy()) {
    return { status: 409, error: "別の処理が進行中です。完了してから再試行してください。" };
  }

  const sourcePath = active.path;
  const sourceId = active.id;
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
    swapLink(finalDest);

    // Update registry: rename old default to a backup label, add new default.
    const freshState = readState();
    const oldEntry = freshState.profiles.find((p) => p.id === sourceId);
    if (oldEntry) {
      oldEntry.name = "default（移行前バックアップ）";
      oldEntry.external = true;
    }
    const newProfile = makeProfile("default", finalDest);
    freshState.profiles.push(newProfile);
    freshState.activeId = newProfile.id;
    writeState(freshState);

    return result.dereferenced
      ? "一部の symlink を実体コピーに置き換えました。"
      : undefined;
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
  const state = readState();
  const profile = state.profiles.find((p) => p.id === id);
  if (!profile) {
    return { status: 409, error: "プロファイルが見つかりません。" };
  }
  profile.name = name.trim();
  writeState(state);
  return { ok: true };
}

/**
 * Remove a profile from the registry only.
 *
 * Never deletes the directory — that is the user's responsibility.
 */
export function unregisterProfile(id: string): { ok: true } | ActivateError {
  const { state, link } = ensureRegistry();
  const activeId = resolveActiveId(state, link);
  if (id === activeId) {
    return { status: 409, error: "アクティブなプロファイルは除外できません。" };
  }
  const index = state.profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    return { status: 409, error: "プロファイルが見つかりません。" };
  }
  state.profiles.splice(index, 1);
  writeState(state);
  return { ok: true };
}
