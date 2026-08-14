import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { dataDir } from '../../scripts/lib/data-dir.mjs';
import { writeSecretFile } from './secure-file.js';

const DEFAULTS = { autoOpenBrowser: false };

function configFile() {
  return join(dataDir(), 'browser-config.json');
}

/** @returns {{ autoOpenBrowser: boolean }} */
export function readBrowserConfig() {
  try {
    if (!existsSync(configFile())) return { ...DEFAULTS };
    const parsed = JSON.parse(readFileSync(configFile(), 'utf8'));
    return { autoOpenBrowser: parsed?.autoOpenBrowser === true };
  } catch {
    return { ...DEFAULTS };
  }
}

/** @param {{ autoOpenBrowser?: boolean }} patch */
export function writeBrowserConfig(patch) {
  const next = {
    autoOpenBrowser:
      typeof patch?.autoOpenBrowser === 'boolean'
        ? patch.autoOpenBrowser
        : readBrowserConfig().autoOpenBrowser,
  };
  writeSecretFile(configFile(), JSON.stringify(next, null, 2));
  return next;
}
