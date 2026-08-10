import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTrustedDeviceStore } from './trusted-device-store.js';

test('trusted device store verifies, revokes, and hashes device tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-trusted-device-'));
  const file = join(dir, 'trusted-devices.json');
  try {
    const store = createTrustedDeviceStore({ file });
    const token = store.issue('alice');
    assert.deepEqual(store.verify(token), { username: 'alice' });
    assert.equal(store.verify('forged'), null);
    assert.equal(existsSync(file), true);
    assert.equal(readFileSync(file, 'utf8').includes(token), false);
    store.revoke(token);
    assert.equal(store.verify(token), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('trusted device store expires tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-trusted-device-'));
  const file = join(dir, 'trusted-devices.json');
  let now = 0;
  try {
    const store = createTrustedDeviceStore({ file, now: () => now });
    const token = store.issue('alice');
    now = 91 * 24 * 60 * 60 * 1000;
    assert.equal(store.verify(token), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
