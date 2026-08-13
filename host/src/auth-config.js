import { dataDir } from '../../scripts/lib/data-dir.mjs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { writeSecretFile } from './secure-file.js';

/**
 * Persisted authentication options, stored next to users.json in
 * %APPDATA%\opencode-webui\auth-config.json.
 *
 * Windows-account login is opt-in on purpose: enabling it means a LAN client
 * can send the operator's real Windows password to this machine, and every
 * wrong guess counts toward the OS account lockout policy. That trade-off has
 * to be a deliberate choice, not a default.
 */

const DEFAULTS = { windowsAuth: false };


function configFile() {
  return join(dataDir(), 'auth-config.json');
}

/** @returns {{ windowsAuth: boolean }} */
export function readAuthConfig() {
  const file = configFile();
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULTS };
    }
    return { windowsAuth: parsed.windowsAuth === true };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist a partial config update and return the stored result.
 * @param {{ windowsAuth?: boolean }} patch
 * @returns {{ windowsAuth: boolean }}
 */
export function writeAuthConfig(patch) {
  const current = readAuthConfig();
  const next = {
    windowsAuth:
      typeof patch?.windowsAuth === 'boolean' ? patch.windowsAuth : current.windowsAuth,
  };
  writeSecretFile(configFile(), JSON.stringify(next, null, 2));
  return next;
}

/** True when Windows-account login is enabled and this host can perform it. */
export function isWindowsAuthEnabled(platform = process.platform) {
  if (platform !== 'win32') return false;
  return readAuthConfig().windowsAuth === true;
}
