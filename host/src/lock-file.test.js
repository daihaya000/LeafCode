import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLock, readLockPid, removeLock, writeLock } from './lock-file.js';

function tempLockDir() {
  return mkdtempSync(path.join(tmpdir(), 'lock-file-test-'));
}

test('readLock reads a new-format JSON lock', () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'host.lock');
  writeFileSync(lockFile, JSON.stringify({ pid: 1234, created: '123' }), 'utf8');
  assert.deepEqual(readLock(lockFile), { pid: 1234, created: '123' });
  assert.equal(readLockPid(lockFile), 1234);
  rmSync(dir, { recursive: true, force: true });
});

test('readLock reads a legacy bare-pid lock', () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'host.lock');
  writeFileSync(lockFile, '4321', 'utf8');
  assert.deepEqual(readLock(lockFile), { pid: 4321, created: null });
  rmSync(dir, { recursive: true, force: true });
});

test('readLock returns null for a missing lock', () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'missing.lock');
  assert.equal(readLock(lockFile), null);
  assert.equal(readLockPid(lockFile), null);
  rmSync(dir, { recursive: true, force: true });
});

test('writeLock claims the lock and backfills creation time', async () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'host.lock');
  writeLock(lockFile);
  assert.equal(existsSync(lockFile), true);
  assert.equal(readLockPid(lockFile), process.pid);
  // The creation-time backfill is async; wait for it to land.
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const lock = readLock(lockFile);
    if (lock?.created) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const lock = readLock(lockFile);
  assert.match(lock.created, /^\d+$/);
  rmSync(dir, { recursive: true, force: true });
});

test('removeLock removes the lock when it owns the pid', () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'host.lock');
  writeLock(lockFile);
  let removedControl = false;
  removeLock(lockFile, { removeControlFile: () => { removedControl = true; } });
  assert.equal(existsSync(lockFile), false);
  assert.equal(removedControl, true);
  rmSync(dir, { recursive: true, force: true });
});

test('removeLock leaves another process lock alone', () => {
  const dir = tempLockDir();
  const lockFile = path.join(dir, 'host.lock');
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid + 1 }), 'utf8');
  removeLock(lockFile);
  assert.equal(existsSync(lockFile), true);
  rmSync(dir, { recursive: true, force: true });
});
