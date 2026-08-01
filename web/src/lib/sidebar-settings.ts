/**
 * Sidebar geometry (expanded projects, width, archived-section expanded)
 * persisted to the server-side `settings` table via `/api/settings/sidebar` so
 * it survives origin/browser-session changes. The three values are bundled
 * into one JSON string under a single DB row to minimize API calls.
 *
 * The localStorage copy in `Sidebar.tsx` remains the synchronous source of
 * truth for instant hydration; this module is the durable backup that wins
 * on conflicts (DB > localStorage on load, and writes mirror to both).
 */

import { getJson, sendJson } from "./client";

let sidebarWriteQueue = Promise.resolve();

export type SidebarState = {
  expanded: string[];
  width: number;
  archivedExpanded: boolean;
};

export type SidebarStateRead = {
  expanded: string[] | null;
  width: number | null;
  archivedExpanded: boolean | null;
};

/**
 * Read the durable sidebar state from the server `settings` table. Returns
 * null for every field when unset, when the request fails, or when running
 * outside the browser. Non-fatal: callers should fall back to localStorage.
 */
export async function readSidebarFromServer(): Promise<SidebarStateRead> {
  const empty: SidebarStateRead = {
    expanded: null,
    width: null,
    archivedExpanded: null,
  };
  if (typeof window === "undefined") return empty;
  try {
    const data = await getJson<{ value: string | null }>(
      "/api/settings/sidebar",
    );
    const raw = data?.value;
    if (typeof raw !== "string" || raw.length === 0) return empty;
    const parsed = JSON.parse(raw) as Partial<SidebarState>;
    return {
      expanded:
        Array.isArray(parsed.expanded) ? parsed.expanded.map(String) : null,
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? parsed.width
          : null,
      archivedExpanded:
        typeof parsed.archivedExpanded === "boolean"
          ? parsed.archivedExpanded
          : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Persist the sidebar state to the server `settings` table. Non-fatal: the
 * localStorage copy has already been updated synchronously by the caller, so
 * a server write failure only means the value won't sync to other browsers.
 */
export async function writeSidebarToServer(
  state: SidebarState,
): Promise<void> {
  if (typeof window === "undefined") return;
  const operation = sidebarWriteQueue.then(async () => {
    try {
      await sendJson("PUT", "/api/settings/sidebar", {
        value: JSON.stringify(state),
      });
    } catch (err) {
      console.warn("writeSidebarToServer failed", err);
    }
  });
  sidebarWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
}
