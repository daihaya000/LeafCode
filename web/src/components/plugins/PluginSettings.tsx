"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { PLUGINS } from "@/lib/plugins/registry";
import {
  isEnabled,
  readPluginPrefs,
  sanitizePrefs,
  writePluginEnabled,
  PLUGINS_CHANGED_EVENT,
  type PluginPrefs,
} from "@/lib/plugins/state";

export function PluginSettings() {
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

  return (
    <ul className="space-y-2">
      {PLUGINS.map((p) => {
        const enabled = hydrated
          ? isEnabled(prefs, p.id, p.defaultEnabled)
          : p.defaultEnabled;
        return (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="text-xs text-faint">{p.description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${p.name} を${enabled ? "無効化" : "有効化"}`}
              disabled={!hydrated}
              onClick={() => writePluginEnabled(p.id, !enabled)}
              className={cx(
                "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40",
                enabled ? "bg-primary" : "bg-surface-3",
              )}
            >
              <span
                className={cx(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform",
                  enabled ? "translate-x-[1.375rem]" : "translate-x-0.5",
                )}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
