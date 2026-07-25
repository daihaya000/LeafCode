/**
 * Right side-panel width persisted to the server-side `settings` table via
 * `/api/settings/sidepanel-width` so it survives origin/browser-session
 * changes. The value is stored as a numeric string.
 *
 * The localStorage copy in `TaskView.tsx` remains the synchronous source of
 * truth for instant hydration; this module is the durable backup that wins
 * on conflicts (DB > localStorage on load, and writes mirror to both).
 */

import { getJson, sendJson } from "./client";

/**
 * Read the durable side-panel width from the server `settings` table. Returns
 * null when unset, when the request fails, or when running outside the
 * browser. Non-fatal: callers should fall back to localStorage.
 */
export async function readSideWidthFromServer(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  try {
    const data = await getJson<{ value: string | null }>(
      "/api/settings/sidepanel-width",
    );
    const raw = data?.value;
    if (typeof raw !== "string" || raw.length === 0) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Persist the side-panel width to the server `settings` table. Non-fatal: the
 * localStorage copy has already been updated synchronously by the caller, so
 * a server write failure only means the value won't sync to other browsers.
 */
export async function writeSideWidthToServer(width: number): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await sendJson("PUT", "/api/settings/sidepanel-width", {
      value: String(width),
    });
  } catch (err) {
    console.warn("writeSideWidthToServer failed", err);
  }
}