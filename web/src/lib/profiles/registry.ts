import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDataDir } from "../paths";
import { cleanupStaleArtifacts, readLinkState } from "./link";
import {
  globalConfigLinkPath,
  isInside,
  profilesRoot,
  profilesStatePath,
  samePath,
} from "./paths";
import type { LinkInfo, Profile, ProfilesState } from "./types";

/**
 * Always build a fresh state: a shared constant would hand every caller the
 * same `profiles` array, and one `push` would leak into every later read.
 */
function emptyState(): ProfilesState {
  return { profiles: [], activeId: null };
}

export function newProfileId(): string {
  return randomBytes(8).toString("hex");
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.path === "string" &&
    v.path.length > 0
  );
}

/** Read the registry, tolerating a missing or corrupt file. */
export function readState(): ProfilesState {
  let raw: string;
  try {
    raw = fs.readFileSync(profilesStatePath(), "utf8");
  } catch {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ProfilesState>;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.filter(isProfile)
      : [];
    const activeId =
      typeof parsed.activeId === "string" ? parsed.activeId : null;
    return { profiles, activeId };
  } catch {
    // A corrupt registry must not brick the settings page; rebuild from the link.
    return emptyState();
  }
}

/** Persist the registry atomically (temp file + rename). */
export function writeState(state: ProfilesState): void {
  ensureDataDir();
  const target = profilesStatePath();
  const tmp = `${target}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, target);
}

/**
 * The active profile is whatever the link actually points at.
 *
 * `activeId` in the registry is only a cache: an external `mklink` must not
 * make the UI lie about which profile is live.
 */
export function resolveActiveId(
  state: ProfilesState,
  link: LinkInfo,
): string | null {
  if (link.state !== "link" || !link.target) return null;
  const match = state.profiles.find((p) => samePath(p.path, link.target!));
  return match?.id ?? null;
}

function markExternal(profilePath: string): { external?: true } {
  return isInside(profilesRoot(), profilePath) ? {} : { external: true };
}

/** Build a profile entry, tagging it when it lives outside profilesRoot. */
export function makeProfile(name: string, profilePath: string): Profile {
  return {
    id: newProfileId(),
    name,
    path: path.resolve(profilePath),
    ...markExternal(profilePath),
  };
}

/**
 * Load the registry, registering the current link target on first run.
 *
 * The pre-existing config directory is registered *in place* — never moved —
 * so enabling the feature cannot disturb a working setup.
 */
export function ensureRegistry(
  linkPath: string = globalConfigLinkPath(),
): { state: ProfilesState; link: LinkInfo } {
  cleanupStaleArtifacts(linkPath);

  const link = readLinkState(linkPath);
  const state = readState();
  let dirty = false;

  if (link.state === "link" && link.target) {
    const known = state.profiles.some((p) => samePath(p.path, link.target!));
    if (!known) {
      state.profiles.push(makeProfile("default", link.target));
      dirty = true;
    }
  }

  const activeId = resolveActiveId(state, link);
  if (state.activeId !== activeId) {
    state.activeId = activeId;
    dirty = true;
  }

  if (dirty) writeState(state);
  return { state, link };
}
