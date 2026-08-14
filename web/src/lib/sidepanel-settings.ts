/**
 * Right side-panel width persisted to the server-side `settings` table via
 * `/api/settings/sidepanel-width` so it survives origin/browser-session
 * changes. The value is stored as a numeric string.
 *
 * The localStorage copy in `TaskView.tsx` remains the synchronous source of
 * truth for instant hydration; this module is the durable backup that wins
 * on conflicts (DB > localStorage on load, and writes mirror to both).
 *
 * The server mirror uses `createSettingSync` (REFACTORING_PLAN P4-d) so rapid
 * drag-resize writes are serialized through the write queue instead of firing
 * overlapping PUTs.
 */

import { createSettingSync } from "./setting-sync";

const SIDE_WIDTH_SYNC = createSettingSync({
  storageKey: "webui:side-panel-width",
  serverPath: "/api/settings/sidepanel-width",
  eventName: "webui:side-panel-width",
});

/**
 * Read the durable side-panel width from the server `settings` table. Returns
 * null when unset, when the request fails, or when running outside the
 * browser. Non-fatal: callers should fall back to localStorage.
 */
export async function readSideWidthFromServer(): Promise<number | null> {
  const raw = await SIDE_WIDTH_SYNC.readFromServer();
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Persist the side-panel width to the server `settings` table. Non-fatal: the
 * localStorage copy has already been updated synchronously by the caller, so
 * a server write failure only means the value won't sync to other browsers.
 */
export async function writeSideWidthToServer(width: number): Promise<void> {
  await SIDE_WIDTH_SYNC.writeToServer(String(width));
}
