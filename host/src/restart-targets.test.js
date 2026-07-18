import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKillPids } from './restart-targets.js';

test('resolveKillPids prefers owned PID over listeners', () => {
  assert.deepEqual(
    resolveKillPids({ ownedPid: 42, listeningPids: [100, 101] }),
    [42],
  );
});

test('resolveKillPids falls back to listening PIDs', () => {
  assert.deepEqual(
    resolveKillPids({ ownedPid: null, listeningPids: [7, 7, 9] }),
    [7, 9],
  );
  assert.deepEqual(resolveKillPids({ listeningPids: [] }), []);
  assert.deepEqual(resolveKillPids({ ownedPid: 0, listeningPids: [3] }), [3]);
});
