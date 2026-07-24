import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disposeAuthHeaders,
  disposeOpencodeServer,
  parseChildPidOutput,
  reapInheritedHolders,
  stopProcessTreeGracefully,
  stopWebTreeSync,
} from './process-stop.js';

test('parseChildPidOutput extracts numeric PIDs only', () => {
  assert.deepEqual(parseChildPidOutput('12\r\n34\r\n\r\nabc\r\n56\n'), [12, 34, 56]);
  assert.deepEqual(parseChildPidOutput(''), []);
});

test('disposeAuthHeaders is empty without password', () => {
  assert.deepEqual(disposeAuthHeaders({}), {});
});

test('disposeAuthHeaders builds Basic auth', () => {
  const headers = disposeAuthHeaders({
    OPENCODE_SERVER_PASSWORD: 'secret',
    OPENCODE_SERVER_USERNAME: 'admin',
  });
  assert.equal(
    headers.Authorization,
    `Basic ${Buffer.from('admin:secret').toString('base64')}`,
  );
});

test('disposeOpencodeServer POSTs /global/dispose', async () => {
  /** @type {{ url: string, method: string }[]} */
  const calls = [];
  const ok = await disposeOpencodeServer('http://127.0.0.1:4096', {
    timeoutMs: 1000,
    env: {},
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return { ok: true };
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, [
    { url: 'http://127.0.0.1:4096/global/dispose', method: 'POST' },
  ]);
});

test('disposeOpencodeServer returns false on network failure', async () => {
  const ok = await disposeOpencodeServer('http://127.0.0.1:4096', {
    fetch: async () => {
      throw new Error('down');
    },
  });
  assert.equal(ok, false);
});

test('stopProcessTreeGracefully returns soft when process dies after soft kill', async () => {
  let alive = true;
  const result = await stopProcessTreeGracefully({
    pid: 99,
    softWaitMs: 50,
    pollMs: 10,
    softKill: () => {
      alive = false;
      return true;
    },
    hardKill: () => {
      throw new Error('should not hard-kill');
    },
    isAlive: () => alive,
    sleep: async () => {},
  });
  assert.equal(result, 'soft');
});

test('stopProcessTreeGracefully escalates to hard kill', async () => {
  const kills = [];
  const result = await stopProcessTreeGracefully({
    pid: 99,
    softWaitMs: 20,
    pollMs: 5,
    softKill: () => {
      kills.push('soft');
      return true;
    },
    hardKill: () => {
      kills.push('hard');
      return true;
    },
    isAlive: () => true,
    sleep: async () => {},
  });
  assert.equal(result, 'hard');
  assert.deepEqual(kills, ['soft', 'hard']);
});

test('reapInheritedHolders kills live children and listeners', () => {
  const killed = [];
  const result = reapInheritedHolders({
    exitedPid: 10,
    listeningPids: [10, 40],
    listChildren: (pid) => (pid === 10 ? [20, 21] : []),
    isAlive: (pid) => pid === 20 || pid === 40,
    hardKill: (pid) => killed.push(pid),
  });
  assert.deepEqual(result.sort((a, b) => a - b), [20, 40]);
  assert.deepEqual(killed.sort((a, b) => a - b), [20, 40]);
});

test('stopWebTreeSync kills the owned tree plus an identified reparented listener', () => {
  const killed = [];
  const result = stopWebTreeSync({
    ownedPid: 42,
    listeningPids: [34872],
    isOwnedListener: (pid) => pid === 34872,
    hardKill: (pid) => killed.push(pid),
  });
  assert.deepEqual(result, [42, 34872]);
  assert.deepEqual(killed, [42, 34872]);
});

test('stopWebTreeSync never kills an unidentified listener', () => {
  const killed = [];
  const result = stopWebTreeSync({
    ownedPid: 42,
    listeningPids: [100],
    isOwnedListener: () => false,
    hardKill: (pid) => killed.push(pid),
  });
  assert.deepEqual(result, [42]);
  assert.deepEqual(killed, [42]);
});

test('stopWebTreeSync is a no-op without an owned PID or listeners', () => {
  const killed = [];
  const result = stopWebTreeSync({
    ownedPid: null,
    listeningPids: [],
    hardKill: (pid) => killed.push(pid),
  });
  assert.deepEqual(result, []);
  assert.deepEqual(killed, []);
});

test('stopWebTreeSync still kills the owned tree when the identifier throws', () => {
  // Exit-cleanup safety: a failing command-line lookup (PowerShell down/timeout)
  // must not prevent killing the process we own, and must not kill anything else.
  const killed = [];
  const result = stopWebTreeSync({
    ownedPid: 42,
    listeningPids: [100, 101],
    isOwnedListener: () => {
      throw new Error('CIM unavailable');
    },
    hardKill: (pid) => killed.push(pid),
  });
  assert.deepEqual(result, [42]);
  assert.deepEqual(killed, [42]);
});

test('stopWebTreeSync tolerates a missing hardKill callback', () => {
  // No hardKill supplied: resolves targets without throwing.
  const result = stopWebTreeSync({ ownedPid: 42, listeningPids: [] });
  assert.deepEqual(result, [42]);
});
