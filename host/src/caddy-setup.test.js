// Simulates a brand-new machine for the Caddy portion of first-run setup:
// no `caddy` on PATH, no WinGet Links shim, and no deploy/Caddyfile yet.
// These paths have side effects (execSync, fs writes) so, unlike the pure
// parsers already covered in caddyfile.test.js / caddy-sites.test.js /
// index.test.js, they previously had no coverage at all.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findCaddy } from './index.js';

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('findCaddy returns null on a fresh machine (no PATH match, no WinGet Links shim)', () => {
  const emptyAppData = mkdtempSync(join(tmpdir(), 'ocw-no-appdata-'));
  try {
    withEnv(
      {
        // System32 is enough for cmd.exe/where.exe to resolve themselves via
        // Windows' default search order, but contains no caddy.exe.
        PATH: `${process.env.SystemRoot}\\System32`,
        LOCALAPPDATA: emptyAppData,
      },
      () => {
        assert.equal(findCaddy(), null);
      },
    );
  } finally {
    rmSync(emptyAppData, { recursive: true, force: true });
  }
});

test('findCaddy falls back to the WinGet Links shim when PATH lookup fails', () => {
  const emptyAppData = mkdtempSync(join(tmpdir(), 'ocw-appdata-'));
  const linksDir = join(emptyAppData, 'Microsoft', 'WinGet', 'Links');
  mkdirSync(linksDir, { recursive: true });
  const shimPath = join(linksDir, 'caddy.exe');
  writeFileSync(shimPath, ''); // existsSync is all findCaddy checks for
  try {
    withEnv(
      {
        PATH: `${process.env.SystemRoot}\\System32`,
        LOCALAPPDATA: emptyAppData,
      },
      () => {
        assert.equal(findCaddy(), shimPath);
      },
    );
  } finally {
    rmSync(emptyAppData, { recursive: true, force: true });
  }
});

test('findCaddy resolves the real install via `where.exe` when PATH is unrestricted', () => {
  // Uses the real, unmodified environment. Skips cleanly on a machine where
  // Caddy genuinely is not installed (that is the null-path test above).
  const result = findCaddy();
  if (result === null) {
    console.log('(skipped assertion: this machine has no caddy on PATH either)');
    return;
  }
  assert.match(result, /caddy(\.exe)?$/i);
});

test('ensureCaddyfile seeds deploy/Caddyfile from the bundled example on first run', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ocw-caddyfile-'));
  const tempCaddyfile = join(tempDir, 'Caddyfile');
  const previous = process.env.OPENCODE_WEBUI_CADDYFILE;
  process.env.OPENCODE_WEBUI_CADDYFILE = tempCaddyfile;
  try {
    // Re-import with a cache-busting query so CADDYFILE picks up the env
    // override above (it is computed once at module load time).
    const mod = await import(`./index.js?caddyfile-seed=${Date.now()}`);
    assert.equal(existsSync(tempCaddyfile), false, 'precondition: no file yet');

    const created = mod.ensureCaddyfile();
    assert.equal(created, true);
    assert.equal(existsSync(tempCaddyfile), true, 'Caddyfile should be seeded');

    const seeded = readFileSync(tempCaddyfile, 'utf8');
    assert.match(seeded, /tls internal/, 'seeded file should come from the example');

    // Second call is the "already exists" no-op branch, not a re-seed.
    writeFileSync(tempCaddyfile, seeded.replace('tls internal', 'tls internal # user-edited'));
    const secondCall = mod.ensureCaddyfile();
    assert.equal(secondCall, true);
    const afterSecondCall = readFileSync(tempCaddyfile, 'utf8');
    assert.match(
      afterSecondCall,
      /user-edited/,
      'an existing Caddyfile must not be overwritten by a later call',
    );
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_WEBUI_CADDYFILE;
    else process.env.OPENCODE_WEBUI_CADDYFILE = previous;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ensureCaddyfile never throws even when the write target is unwritable', async () => {
  // deploy/Caddyfile.example always exists in a checked-out repo, so the
  // "seed source missing" branch is unreachable from a normal install; what
  // matters for startup safety is that a failed write (e.g. permissions, a
  // missing parent directory) is caught and reported as `false` instead of
  // crashing the host.
  const tempDir = mkdtempSync(join(tmpdir(), 'ocw-no-example-'));
  const previous = process.env.OPENCODE_WEBUI_CADDYFILE;
  const bogusPath = join(tempDir, 'missing-parent', 'Caddyfile');
  process.env.OPENCODE_WEBUI_CADDYFILE = bogusPath;
  try {
    const mod = await import(`./index.js?caddyfile-badparent=${Date.now()}`);
    let result;
    assert.doesNotThrow(() => {
      result = mod.ensureCaddyfile();
    });
    assert.equal(result, false);
    assert.equal(existsSync(bogusPath), false);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_WEBUI_CADDYFILE;
    else process.env.OPENCODE_WEBUI_CADDYFILE = previous;
    rmSync(tempDir, { recursive: true, force: true });
  }
});
