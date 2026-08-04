"use client";

import { CODEXBAR_ADDON_ID, type CodexBarUsage } from "@addons/codexbar";
import { getJson } from "@/lib/client";
import { isEnabled, readAddonPrefs } from "@/lib/addons/state";
import type { AutoProviderUsage } from "@/lib/auto-model";

/**
 * Read the current CodexBar snapshot only when its addon is enabled. The
 * snapshot is advisory: unavailable, stale, or unmapped providers are simply
 * omitted so Auto preserves its normal policy.
 */
export async function readCodexBarAutoUsage(): Promise<AutoProviderUsage | undefined> {
  if (
    !isEnabled(readAddonPrefs(), CODEXBAR_ADDON_ID, true)
  ) {
    return undefined;
  }
  try {
    const snapshot = await getJson<CodexBarUsage>("/api/addons/codexbar/usage");
    if (!snapshot.available) return undefined;
    const usage: AutoProviderUsage = {};
    for (const provider of snapshot.providers) {
      if (!provider.opencodeId) continue;
      usage[provider.opencodeId] = {
        usedPercent: provider.usedPercent,
        limited: provider.limited || provider.maxed,
      };
    }
    return Object.keys(usage).length > 0 ? usage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derive the set of OpenCode provider ids whose CodexBar snapshot reports the
 * provider at/over its rate limit. Used by ModelSelect to render those models
 * in danger color so the user can avoid picking a model that will 429.
 */
export function limitedProviderSet(
  usage: AutoProviderUsage | undefined,
): ReadonlySet<string> {
  if (!usage) return EMPTY_LIMITED_SET;
  const set = new Set<string>();
  for (const [providerID, state] of Object.entries(usage)) {
    if (state.limited) set.add(providerID);
  }
  return set.size > 0 ? set : EMPTY_LIMITED_SET;
}

const EMPTY_LIMITED_SET: ReadonlySet<string> = new Set();
