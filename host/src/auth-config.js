import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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

function dataDir() {
  const base =
    process.env.APPDATA ||
    join(process.env.USERPROFILE || process.env.HOME || '.', 'AppData', 'Roaming');
  return join(base, 'opencode-webui');
}

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
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(next, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return next;
}

/** True when Windows-account login is enabled and this host can perform it. */
export function isWindowsAuthEnabled(platform = process.platform) {
  if (platform !== 'win32') return false;
  return readAuthConfig().windowsAuth === true;
}
