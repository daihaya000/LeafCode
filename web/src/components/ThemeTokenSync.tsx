"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  CUSTOM_THEME_CHANGED_EVENT,
  resolveCustomThemeTokens,
} from "@/lib/custom-theme";

/**
 * Applies runtime theme tokens onto `document.documentElement` as inline CSS
 * custom properties.
 *
 * Two sources of truth beyond the static `.light` / `.dark` / `.oyster`
 * classes in `globals.css`:
 *
 * - `oyster` — tokens served by `/api/theme?name=oyster`, which re-reads
 *   `web/themes/oyster.json` from disk per request. Editing the JSON applies
 *   on the next reload without a rebuild.
 * - `custom` — tokens saved from the Settings UI (see `lib/custom-theme.ts`),
 *   re-applied immediately on `webui:custom-theme-changed`.
 *
 * Inline properties take precedence over theme classes, so the classes remain
 * the SSR/pre-hydration fallback. When the active theme is not one of the
 * tokenized ones, previously applied properties are removed so `.light` /
 * `.dark` win again.
 */
const TOKEN_KEY_RE = /^--[a-z0-9-]+$/;

export function ThemeTokenSync() {
  const { resolvedTheme } = useTheme();
  const appliedRef = useRef(new Set<string>());

  useEffect(() => {
    const root = document.documentElement;

    const clear = () => {
      for (const key of appliedRef.current) {
        root.style.removeProperty(key);
      }
      appliedRef.current.clear();
    };

    const apply = (tokens: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(tokens)) {
        if (!TOKEN_KEY_RE.test(key) || typeof value !== "string") continue;
        root.style.setProperty(key, value);
        appliedRef.current.add(key);
      }
    };

    if (resolvedTheme === "custom") {
      apply(resolveCustomThemeTokens());
      const onChanged = () => apply(resolveCustomThemeTokens());
      window.addEventListener(CUSTOM_THEME_CHANGED_EVENT, onChanged);
      return () => {
        window.removeEventListener(CUSTOM_THEME_CHANGED_EVENT, onChanged);
        clear();
      };
    }

    if (resolvedTheme !== "oyster") {
      clear();
      return;
    }

    let cancelled = false;
    void fetch("/api/theme?name=oyster", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((data) => {
        if (cancelled) return;
        const tokens =
          data && typeof data === "object" && "tokens" in data
            ? (data as { tokens: unknown }).tokens
            : null;
        if (!tokens || typeof tokens !== "object" || tokens === null) return;
        apply(tokens as Record<string, unknown>);      })
      .catch(() => {
        // Fall back to the .oyster class already in globals.css.
      });

    return () => {
      cancelled = true;
      clear();
    };
  }, [resolvedTheme]);

  return null;
}
