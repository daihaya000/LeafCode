import type { ComponentType } from "react";

/**
 * A WebUI plugin contributes a small widget rendered by the global
 * `PluginHost` (fixed, bottom-right). Register plugins in `registry.ts`.
 */
export type WebUIPlugin = {
  /** Stable unique id, used as the localStorage/pref key. */
  id: string;
  name: string;
  description: string;
  /** Whether the plugin is on by default (before the user toggles it). */
  defaultEnabled: boolean;
  /** Widget component mounted in the bottom-right overlay when enabled. */
  Widget: ComponentType;
};
