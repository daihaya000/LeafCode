import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isSafeOpenCodeSessionId } from "./opencode-id";
import { dataDir } from "./paths";

/**
 * Machine-local persistence of session metadata.
 *
 * The global SQLite DB ({APPDATA}/opencode-webui/webui.db) is the runtime source
 * of truth. So that workspace/session bindings survive a DB reset, we mirror
 * them into a machine-local manifest at
 * `<dataDir>/projects/<sha1(rootPath)>/sessions.json`. On (re)opening a project
 * the manifest is imported back into the DB so the sessions can be resumed.
 *
 * Session metadata is intentionally never written into the repository
 * (spec change 2026-07-25): bindings survive a DB reset, but intentionally not
 * a machine change/clone. Legacy in-repo manifests
 * (`<root>/.opencode-webui/sessions.json`) are migrated on read and deleted
 * best-effort.
 */

export const MANIFEST_DIR = ".opencode-webui";
export const MANIFEST_FILE = "sessions.json";
export const MANIFEST_VERSION = 1 as const;

/** Stable per-project key: sha1 of the resolved root path (lowercased on win32, case-insensitive FS). */
export function projectKey(rootPath: string): string {
  const resolved = path.resolve(rootPath);
  const norm = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return crypto.createHash("sha1").update(norm).digest("hex");
}

export type ManifestSession = {
  opencodeSessionId: string;
  title: string;
  updatedAt: string;
};

export type ManifestWorkspace = {
  id: string;
  displayName: string;
  absolutePath: string;
  isolation: string;
  baseBranch: string | null;
  worktreePath: string | null;
  status: string;
  createdAt: string;
  sessions: ManifestSession[];
};

export type ProjectSessionManifest = {
  version: typeof MANIFEST_VERSION;
  project: { name: string; rootPath: string };
  workspaces: ManifestWorkspace[];
  updatedAt: string;
};

export function emptyManifest(project: {
  name: string;
  rootPath: string;
}): ProjectSessionManifest {
  return {
    version: MANIFEST_VERSION,
    project: { name: project.name, rootPath: project.rootPath },
    workspaces: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Defensive parse: never throws, returns null when the payload is unusable. */
export function parseManifest(raw: unknown): ProjectSessionManifest | null {
  if (!isRecord(raw)) return null;
  const project = isRecord(raw.project) ? raw.project : {};
  const rootPath = str(project.rootPath);
  if (!rootPath) return null;

  const workspacesRaw = Array.isArray(raw.workspaces) ? raw.workspaces : [];
  const workspaces: ManifestWorkspace[] = [];
  for (const w of workspacesRaw) {
    if (!isRecord(w)) continue;
    const id = str(w.id);
    const absolutePath = str(w.absolutePath);
    if (!id || !absolutePath) continue;
    const sessionsRaw = Array.isArray(w.sessions) ? w.sessions : [];
    const sessions: ManifestSession[] = [];
    for (const s of sessionsRaw) {
      if (!isRecord(s)) continue;
      const sid = str(s.opencodeSessionId);
      if (!sid || !isSafeOpenCodeSessionId(sid)) continue;
      sessions.push({
        opencodeSessionId: sid,
        title: str(s.title),
        updatedAt: str(s.updatedAt, new Date(0).toISOString()),
      });
    }
    workspaces.push({
      id,
      displayName: str(w.displayName, id),
      absolutePath,
      isolation: str(w.isolation, "current_folder"),
      baseBranch: strOrNull(w.baseBranch),
      worktreePath: strOrNull(w.worktreePath),
      status: str(w.status, "active"),
      createdAt: str(w.createdAt, new Date(0).toISOString()),
      sessions,
    });
  }

  return {
    version: MANIFEST_VERSION,
    project: { name: str(project.name, path.basename(rootPath)), rootPath },
    workspaces,
    updatedAt: str(raw.updatedAt, new Date(0).toISOString()),
  };
}

/** Insert/replace a workspace entry (pure). */
export function upsertWorkspaceInManifest(
  manifest: ProjectSessionManifest,
  workspace: ManifestWorkspace,
): ProjectSessionManifest {
  const idx = manifest.workspaces.findIndex((w) => w.id === workspace.id);
  const workspaces = manifest.workspaces.slice();
  if (idx === -1) workspaces.push(workspace);
  else workspaces[idx] = workspace;
  return { ...manifest, workspaces, updatedAt: new Date().toISOString() };
}

/** Drop a workspace entry (pure). */
export function removeWorkspaceFromManifest(
  manifest: ProjectSessionManifest,
  workspaceId: string,
): ProjectSessionManifest {
  const workspaces = manifest.workspaces.filter((w) => w.id !== workspaceId);
  if (workspaces.length === manifest.workspaces.length) return manifest;
  return { ...manifest, workspaces, updatedAt: new Date().toISOString() };
}

export function manifestDir(rootPath: string): string {
  return path.join(dataDir(), "projects", projectKey(rootPath));
}

export function manifestPath(rootPath: string): string {
  return path.join(manifestDir(rootPath), MANIFEST_FILE);
}

/** Legacy in-repo manifest location (pre-2026-07-25); read-only, migrated on sight. */
export function legacyManifestDir(rootPath: string): string {
  return path.join(rootPath, MANIFEST_DIR);
}

export function legacyManifestPath(rootPath: string): string {
  return path.join(legacyManifestDir(rootPath), MANIFEST_FILE);
}

/**
 * Read + defensively parse the manifest for a project root (null if absent).
 * Falls back to the legacy in-repo manifest and migrates it best-effort into
 * the machine-local location when it parses successfully.
 */
export function readProjectManifest(
  rootPath: string,
): ProjectSessionManifest | null {
  const file = manifestPath(rootPath);
  try {
    const parsed = parseManifest(JSON.parse(fs.readFileSync(file, "utf8")));
    if (parsed) return parsed;
  } catch {
    // absent or unparsable: fall through to the legacy location
  }

  const legacyFile = legacyManifestPath(rootPath);
  let legacyText: string;
  try {
    legacyText = fs.readFileSync(legacyFile, "utf8");
  } catch {
    return null;
  }
  let legacyJson: unknown;
  try {
    legacyJson = JSON.parse(legacyText);
  } catch {
    return null;
  }
  const parsed = parseManifest(legacyJson);
  if (!parsed) return null;

  // Best-effort migration: copy to the machine-local location, then remove the
  // in-repo dir. Failures must never break the read itself.
  try {
    writeProjectManifest(rootPath, parsed);
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(legacyManifestDir(rootPath), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  return parsed;
}

/** Persist the manifest to the machine-local data dir (atomic-ish). */
export function writeProjectManifest(
  rootPath: string,
  manifest: ProjectSessionManifest,
): void {
  const dir = manifestDir(rootPath);
  fs.mkdirSync(dir, { recursive: true });
  const file = manifestPath(rootPath);
  const tmp = `${file}.tmp`;
  const body = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}
