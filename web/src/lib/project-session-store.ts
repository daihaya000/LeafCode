import fs from "node:fs";
import path from "node:path";
import { isSafeOpenCodeSessionId } from "./opencode-id";

/**
 * Project-local persistence of session metadata.
 *
 * The global SQLite DB ({APPDATA}/opencode-webui/webui.db) is the runtime source
 * of truth, but it lives outside the repository. To keep the session exchanges
 * "inside the project" — so they survive a DB reset, a fresh machine, or a clone
 * of the repo — we mirror the workspace/session bindings into a manifest file at
 * `<projectRoot>/.opencode-webui/sessions.json`. On (re)opening a project the
 * manifest is imported back into the DB so the sessions can be resumed.
 */

export const MANIFEST_DIR = ".opencode-webui";
export const MANIFEST_FILE = "sessions.json";
export const MANIFEST_VERSION = 1 as const;

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
  return path.join(rootPath, MANIFEST_DIR);
}

export function manifestPath(rootPath: string): string {
  return path.join(rootPath, MANIFEST_DIR, MANIFEST_FILE);
}

/** Read + defensively parse the manifest for a project root (null if absent). */
export function readProjectManifest(
  rootPath: string,
): ProjectSessionManifest | null {
  const file = manifestPath(rootPath);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return parseManifest(json);
}

/** Persist the manifest to `<root>/.opencode-webui/sessions.json` (atomic-ish). */
export function writeProjectManifest(
  rootPath: string,
  manifest: ProjectSessionManifest,
): void {
  const dir = manifestDir(rootPath);
  fs.mkdirSync(dir, { recursive: true });
  // Keep our metadata dir out of the user's repo: a self-ignoring .gitignore
  // makes git treat the whole folder (manifest included) as ignored, so it
  // never shows up as an untracked change or gets committed by accident.
  const ignore = path.join(dir, ".gitignore");
  try {
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n", "utf8");
  } catch {
    /* best effort */
  }
  const file = manifestPath(rootPath);
  const tmp = `${file}.tmp`;
  const body = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}
