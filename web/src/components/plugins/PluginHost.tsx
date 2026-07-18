"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
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

  if (
    !hydrated ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  ) {
    return null;
  }

  const active = PLUGINS.filter((p) => isEnabled(prefs, p.id, p.defaultEnabled));
  if (active.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+9rem)] right-0 z-30 flex w-full flex-col items-end gap-2 px-4 sm:bottom-4 sm:right-4 sm:w-auto sm:px-0 sm:pb-[env(safe-area-inset-bottom)]">
      {active.map((p) => (
        <div key={p.id} className="pointer-events-auto max-w-full">
          <p.Widget />
        </div>
      ))}
    </div>
  );
}
