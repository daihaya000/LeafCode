"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

/**
 * Applies runtime theme tokens from `/api/theme` onto `document.documentElement`
 * as inline CSS custom properties.
 *
 * The token values live in `web/themes/*.json`, so a theme tweak applies on the
 * next reload without rebuilding the WebUI (`next start` serves the API route,
 * which re-reads the JSON from disk on every request).
 *
 * Inline properties take precedence over the `.oyster` class in `globals.css`,
 * so the class remains as the SSR/pre-hydration fallback. When the active theme
 * is not the tokenized one, previously applied properties are removed so
 * `.light` / `.dark` classes win again.
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
        for (const [key, value] of Object.entries(tokens)) {
          if (!TOKEN_KEY_RE.test(key) || typeof value !== "string") continue;
          root.style.setProperty(key, value);
          appliedRef.current.add(key);
        }
      })
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
