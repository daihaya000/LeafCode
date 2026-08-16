import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Manifest V3 uses only minimal required browser permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '116');
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage', 'tabs']);
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(!JSON.stringify(manifest).includes('debugger'));
  assert.ok(!JSON.stringify(manifest).includes('cookies'));
  assert.ok(!JSON.stringify(manifest).includes('downloads'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
});
