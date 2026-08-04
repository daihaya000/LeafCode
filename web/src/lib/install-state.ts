import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";
import { projectKey } from "./project-session-store";

/**
 * Machine-local state for the zip-install git restore / update-badge features.
 * Kept alongside the project session manifest (`<dataDir>/projects/<key>/`,
 * spec change 2026-07-25: never written into the repository itself) rather
 * than under the installation root, so it survives even a full `reset --hard`
 * of the installation and isn't mistaken for repo content.
 */

const STATE_FILE = "install-state.json";
const STATE_VERSION = 1 as const;

export type GitRestorePhase = "cloned" | "done";

export type GitRestoreProgress = {
  /** Absent means "attempted but never got past cloning" (or never attempted). */
  phase?: GitRestorePhase;
  defaultBranch?: string;
  clonedAt?: string;
  doneAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  attemptCount: number;
};

export type UpdateRecord = {
  commit: string;
  fetchedAt: string;
  source: "git-restore" | "zip-update";
};

type InstallState = {
  version: typeof STATE_VERSION;
  gitRestore?: GitRestoreProgress;
  update?: UpdateRecord;
};

function stateDir(rootPath: string): string {
  return path.join(dataDir(), "projects", projectKey(rootPath));
}

function statePath(rootPath: string): string {
  return path.join(stateDir(rootPath), STATE_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readState(rootPath: string): InstallState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(rootPath), "utf8"));
    if (!isRecord(raw)) return { version: STATE_VERSION };
    return {
      version: STATE_VERSION,
      gitRestore: isRecord(raw.gitRestore) ? (raw.gitRestore as GitRestoreProgress) : undefined,
      update: isRecord(raw.update) ? (raw.update as UpdateRecord) : undefined,
    };
  } catch {
    return { version: STATE_VERSION };
  }
}

function writeState(rootPath: string, state: InstallState): void {
  const dir = stateDir(rootPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = statePath(rootPath);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function readGitRestoreProgress(rootPath: string): GitRestoreProgress | null {
  return readState(rootPath).gitRestore ?? null;
}

export function writeGitRestoreProgress(
  rootPath: string,
  patch: Partial<GitRestoreProgress>,
): void {
  const state = readState(rootPath);
  const current = state.gitRestore;
  const merged: GitRestoreProgress = {
    phase: patch.phase ?? current?.phase,
    attemptCount: patch.attemptCount ?? current?.attemptCount ?? 0,
    defaultBranch: patch.defaultBranch ?? current?.defaultBranch,
    clonedAt: patch.clonedAt ?? current?.clonedAt,
    doneAt: patch.doneAt ?? current?.doneAt,
    lastAttemptAt: patch.lastAttemptAt ?? current?.lastAttemptAt,
    lastError: "lastError" in patch ? patch.lastError : current?.lastError,
  };
  writeState(rootPath, { ...state, gitRestore: merged });
}

export function readUpdateRecord(rootPath: string): UpdateRecord | null {
  return readState(rootPath).update ?? null;
}

export function writeUpdateRecord(rootPath: string, record: UpdateRecord): void {
  const state = readState(rootPath);
  writeState(rootPath, { ...state, update: record });
}
