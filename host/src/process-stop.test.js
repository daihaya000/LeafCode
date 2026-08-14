import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disposeAuthHeaders,
  disposeOpencodeServer,
  hardKillTree,
  isProcessAlive,
  listChildPids,
  parseChildPidOutput,
  reapInheritedHolders,
  reapOpencodePortHolders,
  softKillTree,
  stopOpencodeProcessTree,
  stopProcessTreeGracefully,
  stopWebTreeSync,
} from './process-stop.js';

test('parseChildPidOutput extracts numeric PIDs only', () => {
  assert.deepEqual(parseChildPidOutput('12\r\n34\r\n\r\nabc\r\n56\n'), [12, 34, 56]);
  assert.deepEqual(parseChildPidOutput(''), []);
});

test('softKillTree / hardKillTree / listChildPids reject non-integer PIDs', () => {
  const calls = [];
  const execSync = (cmd) => {
    calls.push(cmd);
    return '';
  };
  assert.equal(softKillTree('1 & calc', { execSync }), false);
  assert.equal(hardKillTree('12; rm', { execSync }), false);
  assert.deepEqual(listChildPids('1 | whoami', { execSync }), []);
  assert.equal(softKillTree(12.5, { execSync }), false);
  assert.equal(softKillTree(0, { execSync }), false);
  assert.deepEqual(calls, []);
  assert.equal(softKillTree(42, { execSync }), true);
  assert.deepEqual(calls, ['taskkill /T /PID 42']);
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

test('isProcessAlive rejects invalid PIDs without spawning', () => {
  const calls = [];
  const execSync = (cmd) => {
    calls.push(cmd);
    return '';
  };
  assert.equal(isProcessAlive(0, { execSync }), false);
  assert.equal(isProcessAlive(-1, { execSync }), false);
  assert.equal(isProcessAlive('abc', { execSync }), false);
  assert.deepEqual(calls, []);
});

test('isProcessAlive is true when tasklist output contains the PID', () => {
  const execSync = () => ' node.exe                      4242 Console';
  assert.equal(isProcessAlive(4242, { execSync }), true);
});

test('isProcessAlive is false when tasklist output omits the PID', () => {
  const execSync = () => 'INFO: No tasks are running which match the specified criteria.';
  assert.equal(isProcessAlive(4242, { execSync }), false);
});

test('isProcessAlive is false when tasklist throws', () => {
  const execSync = () => {
    throw new Error('boom');
  };
  assert.equal(isProcessAlive(4242, { execSync }), false);
});

test('stopOpencodeProcessTree is a no-op for empty pid lists', async () => {
  let fetched = false;
  await stopOpencodeProcessTree([], {
    fetch: async () => {
      fetched = true;
      return { ok: true };
    },
  });
  assert.equal(fetched, false);
});

test('stopOpencodeProcessTree disposes opencode when deps.opencodeUrl is set', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return { ok: true };
  };
  try {
    // A dead pid is skipped by isAlive, but the dispose must still fire.
    await stopOpencodeProcessTree([7777], {
      opencodeUrl: 'http://127.0.0.1:4096',
      log: () => {},
      sleep: async () => {},
      isAlive: () => false,
      hardKill: () => true,
    });
    assert.deepEqual(calls, [
      { url: 'http://127.0.0.1:4096/global/dispose', method: 'POST' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reapOpencodePortHolders kills leftover live holders', () => {
  const killed = [];
  reapOpencodePortHolders(10, {
    port: 4096,
    log: () => {},
    isAlive: (pid) => pid === 20 || pid === 40,
    hardKill: (pid) => killed.push(pid),
    getListeningPids: () => [10, 40],
    listChildren: (pid) => (pid === 10 ? [20] : []),
  });
  assert.deepEqual(killed.sort((a, b) => a - b), [20, 40]);
});
