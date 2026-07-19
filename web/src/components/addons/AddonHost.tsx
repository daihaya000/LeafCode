"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ADDONS } from "@/lib/addons/registry";
import {
  isEnabled,
  readAddonPrefs,
  sanitizePrefs,
  ADDONS_CHANGED_EVENT,
  type AddonPrefs,
} from "@/lib/addons/state";

/** Renders every enabled addon widget in the sidebar below project controls. */
export function AddonHost() {
  const pathname = usePathname();
  const [prefs, setPrefs] = useState<AddonPrefs>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(readAddonPrefs());
    setHydrated(true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPrefs(detail ? sanitizePrefs(detail) : readAddonPrefs());
    };
    window.addEventListener(ADDONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ADDONS_CHANGED_EVENT, onChange);
  }, []);

  if (
    !hydrated ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  ) {
    return null;
  }

  const active = ADDONS.filter((p) => isEnabled(prefs, p.id, p.defaultEnabled));
  if (active.length === 0) return null;

  return (
    <div data-testid="addon-host" className="mt-3 flex w-full min-w-0 flex-col gap-2">
      {active.map((p) => (
        <div key={p.id} className="w-full min-w-0">
          <p.Widget />
        </div>
      ))}
    </div>
  );
}
