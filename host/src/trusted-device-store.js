import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { writeSecretFile } from './secure-file.js';

const DEVICE_TOKEN_BYTES = 32;
const DEVICE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function defaultFile() {
  const base = process.env.APPDATA || join(process.env.USERPROFILE || process.env.HOME || '.', 'AppData', 'Roaming');
  return join(base, 'opencode-webui', 'trusted-devices.json');
}

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function readDevices(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((device) =>
      device && typeof device.username === 'string' && typeof device.tokenHash === 'string' &&
      typeof device.expiresAt === 'number',
    ) : [];
  } catch {
    return [];
  }
}

/**
 * Persistent, revocable browser-device tokens. Only SHA-256 hashes are stored,
 * so the file cannot be replayed as a browser credential.
 */
export function createTrustedDeviceStore({ file = defaultFile(), now = () => Date.now() } = {}) {
  function write(devices) {
    writeSecretFile(file, JSON.stringify(devices, null, 2));
  }

  function activeDevices() {
    const devices = readDevices(file);
    const active = devices.filter((device) => device.expiresAt > now());
    if (active.length !== devices.length) write(active);
    return active;
  }

  return {
    issue(username) {
      const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
      const devices = activeDevices();
      devices.push({
        username,
        tokenHash: tokenHash(token).toString('base64'),
        createdAt: now(),
        expiresAt: now() + DEVICE_LIFETIME_MS,
      });
      write(devices);
      return token;
    },
    verify(token) {
      if (typeof token !== 'string' || !token) return null;
      const candidate = tokenHash(token);
      for (const device of activeDevices()) {
        const stored = Buffer.from(device.tokenHash, 'base64');
        if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
          return { username: device.username };
        }
      }
      return null;
    },
    revoke(token) {
      if (typeof token !== 'string' || !token) return;
      const candidate = tokenHash(token);
      const devices = activeDevices();
      const remaining = devices.filter((device) => {
        const stored = Buffer.from(device.tokenHash, 'base64');
        return stored.length !== candidate.length || !timingSafeEqual(stored, candidate);
      });
      if (remaining.length !== devices.length) write(remaining);
    },
  };
}
