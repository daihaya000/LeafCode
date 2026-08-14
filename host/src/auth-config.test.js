import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isWindowsAuthEnabled, readAuthConfig, writeAuthConfig } from './auth-config.js';

const TEST_DIR = join(tmpdir(), `ocw-auth-config-${process.pid}`);
const CONFIG = join(TEST_DIR, 'leafcode', 'auth-config.json');

function withTestDir(fn) {
  const original = process.env.APPDATA;
  process.env.APPDATA = TEST_DIR;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = original;
  }
}

function reset() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

test('readAuthConfig defaults to windowsAuth disabled', () => {
  reset();
  withTestDir(() => {
    assert.deepEqual(readAuthConfig(), { windowsAuth: false });
  });
  reset();
});

test('writeAuthConfig persists the flag', () => {
  reset();
  withTestDir(() => {
    assert.deepEqual(writeAuthConfig({ windowsAuth: true }), { windowsAuth: true });
    assert.deepEqual(readAuthConfig(), { windowsAuth: true });
    assert.ok(existsSync(CONFIG));
  });
  reset();
});

test('writeAuthConfig leaves untouched keys alone', () => {
  reset();
  withTestDir(() => {
    writeAuthConfig({ windowsAuth: true });
    assert.deepEqual(writeAuthConfig({}), { windowsAuth: true });
  });
  reset();
});

test('writeAuthConfig can turn the flag back off', () => {
  reset();
  withTestDir(() => {
    writeAuthConfig({ windowsAuth: true });
    assert.deepEqual(writeAuthConfig({ windowsAuth: false }), { windowsAuth: false });
    assert.equal(readAuthConfig().windowsAuth, false);
  });
  reset();
});

test('readAuthConfig falls back to the default for corrupt json', () => {
  reset();
  withTestDir(() => {
    mkdirSync(join(TEST_DIR, 'leafcode'), { recursive: true });
    writeFileSync(CONFIG, 'not json at all', 'utf8');
    assert.deepEqual(readAuthConfig(), { windowsAuth: false });
  });
  reset();
});

test('readAuthConfig ignores a non-boolean windowsAuth', () => {
  reset();
  withTestDir(() => {
    mkdirSync(join(TEST_DIR, 'leafcode'), { recursive: true });
    // A truthy string must not silently enable Windows logins.
    writeFileSync(CONFIG, JSON.stringify({ windowsAuth: 'yes' }), 'utf8');
    assert.equal(readAuthConfig().windowsAuth, false);
  });
  reset();
});

test('readAuthConfig ignores a json array', () => {
  reset();
  withTestDir(() => {
    mkdirSync(join(TEST_DIR, 'leafcode'), { recursive: true });
    writeFileSync(CONFIG, '[1,2,3]', 'utf8');
    assert.deepEqual(readAuthConfig(), { windowsAuth: false });
  });
  reset();
});

test('isWindowsAuthEnabled is always false off Windows', () => {
  reset();
  withTestDir(() => {
    writeAuthConfig({ windowsAuth: true });
    assert.equal(isWindowsAuthEnabled('linux'), false);
    assert.equal(isWindowsAuthEnabled('win32'), true);
  });
  reset();
});

test('auth-config.json is written with owner-only permissions on POSIX', () => {
  reset();
  withTestDir(() => {
    writeAuthConfig({ windowsAuth: true });
    // Windows has no POSIX mode bits — Node reports 0666 regardless of the
    // requested mode — so this can only be asserted off Windows.
    if (process.platform !== 'win32') {
      assert.equal(statSync(CONFIG).mode & 0o777, 0o600);
    }
    assert.ok(existsSync(CONFIG));
  });
  reset();
});
