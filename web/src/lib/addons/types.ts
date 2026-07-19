import type { ComponentType } from "react";

/**
 * A WebUI addon contributes a small widget rendered by `AddonHost` in the
 * sidebar. Register addons in `registry.ts`.
 *
 * Named "addon" (not "plugin") to avoid confusion with OpenCode plugins.
 */
export type WebUIAddon = {
  /** Stable unique id, used as the localStorage/pref key. */
  id: string;
  name: string;
  description: string;
  /** Whether the addon is on by default (before the user toggles it). */
  defaultEnabled: boolean;
  /** Widget component mounted in the sidebar when enabled. */
  Widget: ComponentType;
};
