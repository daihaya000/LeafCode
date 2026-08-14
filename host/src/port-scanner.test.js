import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureNetstat,
  captureNetstatAsync,
  findFreePort,
  getCommandLineMap,
  getListeningPids,
  isPortInUse,
  makeOwnedWebListenerPredicate,
  parseCommandLineJson,
  runNetstat,
  runPowerShell,
} from './port-scanner.js';

const NETSTAT_SAMPLE = [
  '  TCP    0.0.0.0:3000    0.0.0.0:0   LISTENING   8123',
  '  TCP    127.0.0.1:18765  0.0.0.0:0   LISTENING   4242',
  '  TCP    0.0.0.0:8080    0.0.0.0:0   LISTENING   9999',
].join('\r\n');

test('runPowerShell runs powershell.exe with the command', () => {
  const calls = [];
  const out = runPowerShell('Get-Date', {
    execFileSync: (file, args, options) => {
      calls.push({ file, args, options });
      return '  2026-08-14  \r\n';
    },
  });
  assert.equal(out, '2026-08-14');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.deepEqual(calls[0].args, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date']);
});

test('runNetstat returns output or null on failure', () => {
  assert.equal(
    runNetstat({ execSync: () => NETSTAT_SAMPLE }),
    NETSTAT_SAMPLE,
  );
  assert.equal(
    runNetstat({
      execSync: () => {
        throw new Error('netstat failed');
      },
    }),
    null,
  );
});

test('captureNetstat wraps runNetstat output', () => {
  assert.deepEqual(captureNetstat({ execSync: () => NETSTAT_SAMPLE }), {
    output: NETSTAT_SAMPLE,
  });
  assert.deepEqual(
    captureNetstat({
      execSync: () => {
        throw new Error('down');
      },
    }),
    null,
  );
});

test('captureNetstatAsync returns stdout or null', async () => {
  const ok = await captureNetstatAsync({
    execFileAsync: async () => ({ stdout: NETSTAT_SAMPLE }),
  });
  assert.deepEqual(ok, { output: NETSTAT_SAMPLE });
  const failed = await captureNetstatAsync({
    execFileAsync: async () => {
      throw new Error('down');
    },
  });
  assert.equal(failed, null);
});

test('getListeningPids parses listening pids for the requested port', () => {
  const pids = getListeningPids(3000, { output: NETSTAT_SAMPLE });
  assert.deepEqual(pids, [8123]);
  assert.deepEqual(getListeningPids(99999, { output: NETSTAT_SAMPLE }), []);
});

test('getListeningPids falls back to a fresh netstat when no snapshot is given', () => {
  const pids = getListeningPids(18765, undefined, { execSync: () => NETSTAT_SAMPLE });
  assert.deepEqual(pids, [4242]);
});

test('isPortInUse reflects the snapshot', () => {
  assert.equal(isPortInUse(8080, { output: NETSTAT_SAMPLE }), true);
  assert.equal(isPortInUse(9999, { output: NETSTAT_SAMPLE }), false);
});

test('findFreePort skips busy ports and returns the first free one', () => {
  const snapshot = { output: NETSTAT_SAMPLE };
  const result = findFreePort(8080, 10, { execSync: () => NETSTAT_SAMPLE });
  // 8080 is busy; 8081 must be free in the snapshot.
  assert.equal(result, 8081);
  void snapshot;
});

test('parseCommandLineJson maps pids to command lines', () => {
  const map = parseCommandLineJson(
    '[{"ProcessId":100,"CommandLine":"node a.js"},{"ProcessId":200,"CommandLine":"node b.js"}]',
  );
  assert.deepEqual([...map.entries()], [[100, 'node a.js'], [200, 'node b.js']]);
});

test('parseCommandLineJson is defensive on malformed input', () => {
  assert.equal(parseCommandLineJson('').size, 0);
  assert.equal(parseCommandLineJson('not json').size, 0);
  assert.equal(parseCommandLineJson('[{"ProcessId":"x"}]').size, 0);
  assert.equal(parseCommandLineJson('[{"ProcessId":0}]').size, 0);
  assert.equal(parseCommandLineJson('[{"ProcessId":5}]').size, 0);
  assert.equal(parseCommandLineJson('{}').size, 0);
});

test('getCommandLineMap batches a WQL filter over validated pids', () => {
  const calls = [];
  const map = getCommandLineMap([10, 20, -1, 'x', 10], {
    runPowerShell: (command) => {
      calls.push(command);
      return '[{"ProcessId":10,"CommandLine":"node a"},{"ProcessId":20,"CommandLine":"node b"}]';
    },
  });
  assert.deepEqual([...map.entries()], [[10, 'node a'], [20, 'node b']]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('ProcessId=10 OR ProcessId=20'));
  assert.ok(!calls[0].includes('-1'));
});

test('getCommandLineMap returns empty on failure and for no pids', () => {
  assert.equal(
    getCommandLineMap([], {}).size,
    0,
  );
  assert.equal(
    getCommandLineMap([1], { runPowerShell: () => { throw new Error('down'); } }).size,
    0,
  );
});

test('makeOwnedWebListenerPredicate identifies our next start listener', () => {
  const webDir = 'C:\\LeafCode\\web';
  const cmdline = `"C:\\node.exe" "${webDir}\\node_modules\\next\\dist\\bin\\next" start --port 3000`;
  const predicate = makeOwnedWebListenerPredicate([8123], webDir, {
    runPowerShell: () =>
      JSON.stringify([{ ProcessId: 8123, CommandLine: cmdline }]),
    isThisWebUiNextStart: (commandLine, dir) =>
      commandLine.includes('next') && commandLine.includes(dir),
  });
  assert.equal(predicate(8123), true);
  assert.equal(predicate(9999), false);
});

test('makeOwnedWebListenerPredicate never identifies an unknown pid', () => {
  const predicate = makeOwnedWebListenerPredicate([], 'C:\\web', {
    runPowerShell: () => '[]',
  });
  assert.equal(predicate(8123), false);
});
