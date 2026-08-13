/**
 * Resolve a runnable OpenCode CLI path on Windows.
 *
 * Delegated to the shared `scripts/lib/opencode-path.mjs` implementation
 * (REFACTORING_PLAN P1-c / IMPROVEMENT 6-3). Exports are re-exported so
 * `host/src/index.js` and the tests keep working unchanged.
 */

import {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  pickOpencodePath,
  wingetLinkPath,
} from '../../scripts/lib/opencode-path.mjs';

export {
  isWindowsPeExecutable,
  npmOpencodeSiblingExe,
  pickOpencodePath,
  wingetLinkPath,
};

/**
 * WinGet Links shim path for SST.opencode. Kept for backward compatibility
 * with the pre-shared-module API; prefer `wingetLinkPath('opencode', …)`.
 * @param {string | undefined} localAppData
 * @returns {string | null}
 */
export function wingetOpencodeLink(localAppData) {
  return wingetLinkPath('opencode', localAppData);
}
