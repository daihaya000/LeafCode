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
