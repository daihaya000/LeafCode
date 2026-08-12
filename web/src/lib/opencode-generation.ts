/**
 * Single switch point for the OpenCode API generation the client uses.
 *
 * The engine currently exposes two generations side by side:
 *
 * - **v1** — the original flat surface (`/session`, `/session/{id}/message`,
 *   `/permission`, ...).
 * - **v2 (beta)** — the `/api/*` surface (`/api/session/{id}/prompt`,
 *   `/api/session/{id}/interrupt`, ...).
 *
 * Migration plan (Phase D, see `docs/specs/opencode-api-v2-migration.md`):
 * v2-migration-target operations (session CRUD, prompt, interrupt, compact,
 * permission, question, revert, SSE) resolve to their `...PathV2` builders
 * when the active generation is `"v2"`; v1-maintain operations (todo, diff,
 * command, children, ...) keep their v1 builders regardless.
 *
 * The generation is user-configurable from the Settings → Engine tab and
 * persisted in two layers (same scheme as `token-saving-settings.ts`):
 *
 * - **localStorage** is the synchronous source of truth for the browser
 *   (instant hydration, no request on first paint, immediate react.
 *   `isV2ApiGeneration()` reads it live so a setting change takes effect
 *   without a reload).
 * - **server `settings` table** (`/api/settings/opencode-api-generation`) is
 *   the durable backup shared across browsers.
 *
 * Server-side code (BFF proxy, goal-loop, ...) has no `window`, so it reads
 * the compile-time default via {@link readOpenCodeApiGeneration}. The
 * generation is a client-routing concern: the BFF transparently proxies both
 * `/session/*` and `/api/session/*`, so a server-side default of "v1" stays
 * correct even when the browser chose v2.
 */

export type OpenCodeApiGeneration = "v1" | "v2";

/** Default used on the server and when localStorage is unavailable. */
export const DEFAULT_OPENCODE_API_GENERATION: OpenCodeApiGeneration = "v1";

const STORAGE_KEY = "webui:opencode-api-generation";
export const OPENCODE_API_GENERATION_EVENT = "webui:opencode-api-generation";
export const OPENCODE_API_GENERATION_SETTING_KEY = "opencode-api-generation";

const VALID_GENERATIONS: readonly OpenCodeApiGeneration[] = ["v1", "v2"];

export function isOpenCodeApiGeneration(
  value: unknown,
): value is OpenCodeApiGeneration {
  return (
    typeof value === "string" &&
    (VALID_GENERATIONS as readonly string[]).includes(value)
  );
}

/** Read the generation: browser localStorage on the client, default on server. */
export function readOpenCodeApiGeneration(): OpenCodeApiGeneration {
  if (typeof window === "undefined") return DEFAULT_OPENCODE_API_GENERATION;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isOpenCodeApiGeneration(raw)
      ? raw
      : DEFAULT_OPENCODE_API_GENERATION;
  } catch {
    return DEFAULT_OPENCODE_API_GENERATION;
  }
}

/** Persist the generation locally and notify subscribers. */
export function writeOpenCodeApiGeneration(
  generation: OpenCodeApiGeneration,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, generation);
    window.dispatchEvent(
      new CustomEvent(OPENCODE_API_GENERATION_EVENT, { detail: generation }),
    );
  } catch {
    // Settings are best-effort when storage is unavailable.
  }
}

/** Subscribe to generation changes (same tab + cross-tab). */
export function subscribeOpenCodeApiGeneration(
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(OPENCODE_API_GENERATION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(OPENCODE_API_GENERATION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** True when the client uses v2 paths for migration-target operations. */
export function isV2ApiGeneration(): boolean {
  return readOpenCodeApiGeneration() === "v2";
}

/** Durable server copy — same key read/written by `/api/settings/:key`. */
export async function syncOpenCodeApiGenerationToServer(
  generation: OpenCodeApiGeneration,
): Promise<void> {
  try {
    const res = await fetch(`/api/settings/${OPENCODE_API_GENERATION_SETTING_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: generation }),
    });
    if (!res.ok) throw new Error(`settings write failed: ${res.status}`);
  } catch {
    // localStorage remains the synchronous source of truth.
  }
}

export async function readOpenCodeApiGenerationFromServer(): Promise<
  OpenCodeApiGeneration | undefined
> {
  try {
    const res = await fetch(`/api/settings/${OPENCODE_API_GENERATION_SETTING_KEY}`, {
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { value: string | null };
    return isOpenCodeApiGeneration(data.value)
      ? data.value
      : undefined;
  } catch {
    return undefined;
  }
}
