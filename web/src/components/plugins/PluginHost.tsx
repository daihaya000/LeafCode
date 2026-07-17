"use client";

import { useEffect, useState } from "react";
import { PLUGINS } from "@/lib/plugins/registry";
import {
  isEnabled,
  readPluginPrefs,
  sanitizePrefs,
  PLUGINS_CHANGED_EVENT,
  type PluginPrefs,
} from "@/lib/plugins/state";

/**
 * Global overlay that renders every enabled plugin widget in the bottom-right
 * corner. Mounted once in the app shell so it appears on all pages.
 */
export function PluginHost() {
  const [prefs, setPrefs] = useState<PluginPrefs>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(readPluginPrefs());
    setHydrated(true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPrefs(detail ? sanitizePrefs(detail) : readPluginPrefs());
    };
    window.addEventListener(PLUGINS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onChange);
  }, []);

  if (!hydrated) return null;

  const active = PLUGINS.filter((p) => isEnabled(prefs, p.id, p.defaultEnabled));
  if (active.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2 pb-[env(safe-area-inset-bottom)]">
      {active.map((p) => (
        <div key={p.id} className="pointer-events-auto">
          <p.Widget />
        </div>
      ))}
    </div>
  );
}
