/** A switchable OpenCode global-config directory. */
export type Profile = {
  /** Stable id, never reused. */
  id: string;
  /** Display label. Editable, and intentionally decoupled from the directory name. */
  name: string;
  /** Absolute path to the config directory. Fixed at creation. */
  path: string;
  /** Set when the directory lives outside `dataDir()/profiles` (e.g. pre-migration default). */
  external?: true;
};

export type ProfilesState = {
  profiles: Profile[];
  activeId: string | null;
};

/**
 * State of `~/.config/opencode`.
 *
 * Windows junctions and directory symlinks are both reported as `link`: Node
 * reports `isSymbolicLink() === true` for both and telling them apart needs an
 * external `fsutil` call, which has no functional benefit here.
 */
export type LinkState = "link" | "realdir" | "missing";

export type LinkInfo = {
  state: LinkState;
  /** Resolved absolute target, only when `state === "link"`. */
  target: string | null;
};

export type ProfileDto = Profile & {
  active: boolean;
  exists: boolean;
};
