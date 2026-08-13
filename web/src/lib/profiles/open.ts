/**
 * Cross-platform "reveal in file manager" helpers.
 *
 * Shared by every WebUI feature that lets the user jump from a status row
 * to the underlying file/folder on disk (profile config, sync targets,
 * AGENTS.md mirrors, skills folders, ...).
 */
import { spawnSync } from "node:child_process";

/** Open action accepted by the profiles open routes (IMPROVEMENT 2-5). */
export type OpenAction = "open-file" | "open-folder";

/**
 * Validate an action from a request body. Shared by the profiles open routes
 * so the action check and the open invocation stay in one place.
 */
export function parseOpenAction(action: unknown): OpenAction | null {
  return action === "open-file" || action === "open-folder" ? action : null;
}

/**
 * Run an open action on a single target. Returns an error message or null.
 * Shared by the profiles open routes (IMPROVEMENT 2-5).
 */
export function runOpenAction(
  action: OpenAction,
  target: string,
): string | null {
  return action === "open-file" ? openFileReveal(target) : openFolder(target);
}

/** Open `target` (a directory) in the OS file manager. */
export function openFolder(target: string): string | null {
  if (process.platform === "win32") {
    // explorer.exe launched directly from a service/desktop-orphaned process
    // returns 1 and does nothing. Going through powershell.exe with a quoted
    // path works reliably.
    const escaped = target.replace(/'/g, "''");
    const script = `explorer '${escaped}'`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.error) return result.error.message;
    return null;
  }
  if (process.platform === "darwin") {
    const result = spawnSync("open", [target], { encoding: "utf8" });
    if (result.error) return result.error.message;
    return null;
  }
  const result = spawnSync("xdg-open", [target], { encoding: "utf8" });
  if (result.error) return result.error.message;
  return null;
}

/** Reveal `target` (a file) in the OS file manager, selecting it. */
export function openFileReveal(target: string): string | null {
  if (process.platform === "win32") {
    // Use powershell.exe as the launcher so explorer gets a real shell context.
    const escaped = target.replace(/'/g, "''");
    const script = `explorer /select,'${escaped}'`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.error) return result.error.message;
    return null;
  }
  if (process.platform === "darwin") {
    const result = spawnSync("open", ["-R", target], { encoding: "utf8" });
    if (result.error) return result.error.message;
    return null;
  }
  // Linux: xdg-open generally opens the default editor for files.
  const result = spawnSync("xdg-open", [target], { encoding: "utf8" });
  if (result.error) return result.error.message;
  return null;
}
