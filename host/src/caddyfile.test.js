import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const caddyfilePath = resolve(repoRoot, 'deploy', 'Caddyfile.example');

test('Caddyfile example rewrites Host for host-only API routes', () => {
  const caddyfile = readFileSync(caddyfilePath, 'utf8');
  const matcherLine = caddyfile
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('@hostOnlyApis path'));
  const handleLine = caddyfile
    .split(/\r?\n/)
    .find((line) => line.trim() === 'handle @hostOnlyApis {');

  assert.ok(matcherLine, 'host-only API matcher is missing');
  assert.ok(handleLine, 'host-only API handle is missing');
  for (const route of [
    '/api/browse/folder*',
    '/api/host/voice-input*',
    '/api/host/restart*',
    '/api/host/shutdown*',
    '/api/host/logs*',
    '/api/updates/*',
  ]) {
    assert.match(matcherLine, new RegExp(route.replaceAll('*', '\\*')));
  }
});

test('Caddyfile example disables HTTP/3 so phones are not sent to blocked UDP', () => {
  const caddyfile = readFileSync(caddyfilePath, 'utf8');
  const protocols = caddyfile
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('protocols '));

  // h3 makes Caddy advertise `Alt-Svc: h3=":8443"; ma=2592000`. Browsers cache
  // that for 30 days and move to QUIC on UDP 8443, which the firewall helper
  // never opens (TCP only) and VPNs frequently drop -- phones then blackhole
  // with a blank page while the host PC still works over TCP.
  assert.ok(protocols, 'global `servers { protocols ... }` is missing');
  assert.equal(protocols.trim(), 'protocols h1 h2');
  assert.doesNotMatch(protocols, /\bh3\b/, 'HTTP/3 must stay disabled');
});

test('Caddyfile example is valid when caddy is installed', { skip: !hasCaddy() }, () => {
  const result = spawnSync(
    'caddy',
    ['validate', '--config', caddyfilePath, '--adapter', 'caddyfile'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
});

function hasCaddy() {
  const result = spawnSync('caddy', ['version'], { encoding: 'utf8' });
  return result.status === 0;
}
