import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBrowserConfig, writeBrowserConfig } from './browser-config.js';

const TEST_DIR = join(tmpdir(), `ocw-browser-config-${process.pid}`);

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

test('readBrowserConfig defaults to automatic browser opening disabled', () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  withTestDir(() => assert.deepEqual(readBrowserConfig(), { autoOpenBrowser: false }));
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test('writeBrowserConfig persists the setting', () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  withTestDir(() => {
    assert.deepEqual(writeBrowserConfig({ autoOpenBrowser: true }), { autoOpenBrowser: true });
    assert.deepEqual(readBrowserConfig(), { autoOpenBrowser: true });
    assert.ok(existsSync(join(TEST_DIR, 'leafcode', 'browser-config.json')));
  });
  rmSync(TEST_DIR, { recursive: true, force: true });
});
