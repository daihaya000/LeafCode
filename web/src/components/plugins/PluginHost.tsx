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

/** Renders every enabled plugin widget in the sidebar below project controls. */
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
    <div data-testid="plugin-host" className="mt-3 flex w-full min-w-0 flex-col gap-2">
      {active.map((p) => (
        <div key={p.id} className="w-full min-w-0">
          <p.Widget />
        </div>
      ))}
    </div>
  );
}
