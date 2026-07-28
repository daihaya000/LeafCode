import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

test('Caddyfile example rewrites Host for host-only API routes', () => {
  const caddyfile = readFileSync(
    resolve(repoRoot, 'deploy', 'Caddyfile.example'),
    'utf8',
  );
  const handleLine = caddyfile
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('handle /api/browse/folder'));

  assert.ok(handleLine, 'host-only API handle is missing');
  for (const route of [
    '/api/browse/folder*',
    '/api/host/voice-input*',
    '/api/host/restart*',
    '/api/host/logs*',
    '/api/updates/*',
  ]) {
    assert.match(handleLine, new RegExp(route.replaceAll('*', '\\*')));
  }
});
