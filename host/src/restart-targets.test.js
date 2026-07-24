import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKillPids, resolveWebKillPids } from './restart-targets.js';

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

test('resolveWebKillPids unions owned PID with an identified (reparented) listener', () => {
  // The bug: a `next start` that survived a crash is reparented and keeps
  // holding the port outside the owned tree. It must be stopped alongside the
  // owned child.
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [34872],
      isOwnedListener: (pid) => pid === 34872,
    }),
    [42, 34872],
  );
});

test('resolveWebKillPids never kills an unidentified listener when an owned PID exists', () => {
  // An unrelated app occupying the port must be left alone.
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [100, 101],
      isOwnedListener: () => false,
    }),
    [42],
  );
});

test('resolveWebKillPids keeps only identified listeners in the union', () => {
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [34872, 999],
      isOwnedListener: (pid) => pid === 34872,
    }),
    [42, 34872],
  );
});

test('resolveWebKillPids dedupes a listener that equals the owned PID', () => {
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [42, 42],
      isOwnedListener: () => true,
    }),
    [42],
  );
});

test('resolveWebKillPids defaults to owned-only when no identifier is supplied', () => {
  // Safe default: with an owned child but no way to attribute listeners, do
  // not expand the kill set.
  assert.deepEqual(
    resolveWebKillPids({ ownedPid: 42, listeningPids: [100] }),
    [42],
  );
});

test('resolveWebKillPids falls back to all listeners without an owned PID', () => {
  // Reuse / leftover-listener case: no child tree to attribute to, so match the
  // historical resolveKillPids fallback (deduped, invalid entries dropped).
  assert.deepEqual(
    resolveWebKillPids({ ownedPid: null, listeningPids: [7, 7, 9, 0, -1, NaN] }),
    [7, 9],
  );
  assert.deepEqual(resolveWebKillPids({ listeningPids: [] }), []);
});

test('resolveWebKillPids keeps the owned PID when the identifier throws', () => {
  // A throwing isOwnedListener must not abort resolution nor drop the owned
  // child: the caller still kills the process it owns, and nothing else.
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [100, 101],
      isOwnedListener: () => {
        throw new Error('CIM unavailable');
      },
    }),
    [42],
  );
});

test('resolveWebKillPids tolerates a throwing identifier for one listener only', () => {
  // The throw affects PID 100; PID 101 is still evaluated and included.
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [100, 101],
      isOwnedListener: (pid) => {
        if (pid === 100) throw new Error('transient');
        return pid === 101;
      },
    }),
    [42, 101],
  );
});

test('resolveWebKillPids treats truthy non-boolean identifier results as not owned', () => {
  // Only a strict `true` counts as identified; truthy junk stays safe.
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: [100],
      isOwnedListener: () => 'yes',
    }),
    [42],
  );
});

test('resolveWebKillPids is safe against malformed inputs', () => {
  // Non-array listeners, missing fields, and non-numeric owned PIDs never throw
  // and never expand the kill set unexpectedly.
  assert.deepEqual(resolveWebKillPids({ ownedPid: 42, listeningPids: null }), [42]);
  assert.deepEqual(resolveWebKillPids({ ownedPid: 42 }), [42]);
  assert.deepEqual(resolveWebKillPids({}), []);
  assert.deepEqual(resolveWebKillPids({ ownedPid: -5, listeningPids: [] }), []);
  // No owner → listeners fallback (NaN owned is treated as absent).
  assert.deepEqual(resolveWebKillPids({ ownedPid: NaN, listeningPids: [3] }), [3]);
});

test('resolveWebKillPids coerces numeric-string PIDs', () => {
  assert.deepEqual(resolveWebKillPids({ ownedPid: '42' }), [42]);
  assert.deepEqual(
    resolveWebKillPids({
      ownedPid: 42,
      listeningPids: ['7'],
      isOwnedListener: () => true,
    }),
    [42, 7],
  );
});
