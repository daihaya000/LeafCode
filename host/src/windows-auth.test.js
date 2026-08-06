import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createLoginThrottle,
  createThrottleStore,
  parseWindowsUsername,
  verifyWindowsCredentials,
} from './windows-auth.js';

/** Minimal child_process.spawn stub that replays a canned stdout/stderr. */
function fakeSpawn({ stdout = '', stderr = '', failWith = null, hang = false } = {}) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    const written = [];
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdin = {
      end: (data) => {
        written.push(data);
      },
    };
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ file, args, options, written, child });

    if (failWith) {
      setImmediate(() => child.emit('error', failWith));
      return child;
    }
    if (hang) return child;

    setImmediate(() => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', 0);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

const WIN = { platform: 'win32', scriptPath: 'C:\\fake\\validate.ps1' };

test('parseWindowsUsername treats a bare name as a local account', () => {
  const parsed = parseWindowsUsername('alice', 'MYPC');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'alice');
  assert.equal(parsed.domain, null);
  assert.equal(parsed.kind, 'machine');
});

test('parseWindowsUsername splits DOMAIN\\user', () => {
  const parsed = parseWindowsUsername('CORP\\alice', 'MYPC');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'alice');
  assert.equal(parsed.domain, 'CORP');
  assert.equal(parsed.kind, 'domain');
});

test('parseWindowsUsername treats the local computer name as a machine account', () => {
  for (const raw of ['MYPC\\alice', '.\\alice', 'localhost\\alice', 'mypc\\alice']) {
    const parsed = parseWindowsUsername(raw, 'MYPC');
    assert.equal(parsed.ok, true, raw);
    assert.equal(parsed.kind, 'machine', raw);
    assert.equal(parsed.name, 'alice', raw);
  }
});

test('parseWindowsUsername treats a UPN as a domain account', () => {
  const parsed = parseWindowsUsername('alice@corp.example', 'MYPC');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, 'alice');
  assert.equal(parsed.domain, 'corp.example');
  assert.equal(parsed.kind, 'domain');
});

test('parseWindowsUsername rejects newlines so the stdin framing cannot be spoofed', () => {
  for (const raw of ['alice\nbob', 'alice\r\nbob', 'alice\u0000', 'alice\tbob']) {
    assert.equal(parseWindowsUsername(raw, 'MYPC').ok, false, JSON.stringify(raw));
  }
});

test('parseWindowsUsername rejects empty and malformed input', () => {
  for (const raw of ['', '   ', 'CORP\\', '\\alice', '@corp', null, undefined, 42]) {
    assert.equal(parseWindowsUsername(raw, 'MYPC').ok, false, JSON.stringify(raw));
  }
});

test('parseWindowsUsername trims surrounding whitespace', () => {
  const parsed = parseWindowsUsername('  alice  ', 'MYPC');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.raw, 'alice');
});

test('verifyWindowsCredentials resolves true only for a VALID verdict', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  assert.equal(await verifyWindowsCredentials('alice', 'pw', { ...WIN, spawn }), true);
});

test('verifyWindowsCredentials resolves false for INVALID', async () => {
  const spawn = fakeSpawn({ stdout: 'INVALID\n' });
  assert.equal(await verifyWindowsCredentials('alice', 'pw', { ...WIN, spawn }), false);
});

test('verifyWindowsCredentials resolves false for an ERROR verdict and reports it', async () => {
  const spawn = fakeSpawn({ stdout: 'ERROR:server unreachable\n' });
  const messages = [];
  const ok = await verifyWindowsCredentials('alice', 'pw', {
    ...WIN,
    spawn,
    onError: (m) => messages.push(m),
  });
  assert.equal(ok, false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /server unreachable/);
});

test('verifyWindowsCredentials resolves false for unrecognised output', async () => {
  const spawn = fakeSpawn({ stdout: 'who knows\n' });
  assert.equal(await verifyWindowsCredentials('alice', 'pw', { ...WIN, spawn }), false);
});

test('verifyWindowsCredentials resolves false when powershell cannot start', async () => {
  const spawn = fakeSpawn({ failWith: new Error('ENOENT') });
  assert.equal(await verifyWindowsCredentials('alice', 'pw', { ...WIN, spawn }), false);
});

test('verifyWindowsCredentials resolves false on timeout and kills the child', async () => {
  const spawn = fakeSpawn({ hang: true });
  const ok = await verifyWindowsCredentials('alice', 'pw', {
    ...WIN,
    spawn,
    timeoutMs: 10,
  });
  assert.equal(ok, false);
  assert.equal(spawn.calls[0].child.killed, true);
});

test('verifyWindowsCredentials never passes the password as an argument', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  await verifyWindowsCredentials('alice', 'sup3rs3cret', { ...WIN, spawn });
  const { args, file, written } = spawn.calls[0];
  assert.equal(file, 'powershell.exe');
  for (const arg of args) {
    assert.ok(!String(arg).includes('sup3rs3cret'), `password leaked into argv: ${arg}`);
  }
  // It must instead arrive as the second stdin line.
  assert.equal(written.join(''), 'alice\nsup3rs3cret\n');
});

test('verifyWindowsCredentials uses Windows PowerShell with -File and no profile', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  await verifyWindowsCredentials('alice', 'pw', { ...WIN, spawn });
  const { args, options } = spawn.calls[0];
  assert.ok(args.includes('-NoProfile'));
  assert.ok(args.includes('-NonInteractive'));
  assert.equal(args[args.length - 2], '-File');
  assert.equal(args[args.length - 1], WIN.scriptPath);
  assert.equal(options.windowsHide, true);
});

test('verifyWindowsCredentials refuses to run off Windows', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  const ok = await verifyWindowsCredentials('alice', 'pw', {
    ...WIN,
    platform: 'linux',
    spawn,
  });
  assert.equal(ok, false);
  assert.equal(spawn.calls.length, 0);
});

test('verifyWindowsCredentials rejects an empty password without spawning', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  assert.equal(await verifyWindowsCredentials('alice', '', { ...WIN, spawn }), false);
  assert.equal(spawn.calls.length, 0);
});

test('verifyWindowsCredentials rejects a newline in the password without spawning', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  assert.equal(await verifyWindowsCredentials('alice', 'a\nVALID', { ...WIN, spawn }), false);
  assert.equal(spawn.calls.length, 0);
});

test('verifyWindowsCredentials rejects a malformed username without spawning', async () => {
  const spawn = fakeSpawn({ stdout: 'VALID\n' });
  assert.equal(await verifyWindowsCredentials('', 'pw', { ...WIN, spawn }), false);
  assert.equal(spawn.calls.length, 0);
});

test('createLoginThrottle blocks after the attempt limit', () => {
  let now = 1000;
  const throttle = createLoginThrottle({ maxAttempts: 3, windowMs: 60_000, now: () => now });

  assert.equal(throttle.isBlocked('alice'), false);
  throttle.recordFailure('alice');
  throttle.recordFailure('alice');
  assert.equal(throttle.isBlocked('alice'), false);
  throttle.recordFailure('alice');
  assert.equal(throttle.isBlocked('alice'), true);
  assert.ok(throttle.retryAfterMs('alice') > 0);
});

test('createLoginThrottle is per username', () => {
  let now = 1000;
  const throttle = createLoginThrottle({ maxAttempts: 1, windowMs: 60_000, now: () => now });
  throttle.recordFailure('alice');
  assert.equal(throttle.isBlocked('alice'), true);
  assert.equal(throttle.isBlocked('bob'), false);
});

test('createLoginThrottle ignores username case and whitespace', () => {
  const throttle = createLoginThrottle({ maxAttempts: 1, windowMs: 60_000 });
  throttle.recordFailure('Alice');
  assert.equal(throttle.isBlocked('  alice '), true);
});

test('createLoginThrottle expires the window', () => {
  let now = 1000;
  const throttle = createLoginThrottle({ maxAttempts: 1, windowMs: 60_000, now: () => now });
  throttle.recordFailure('alice');
  assert.equal(throttle.isBlocked('alice'), true);
  now += 60_000;
  assert.equal(throttle.isBlocked('alice'), false);
  assert.equal(throttle.retryAfterMs('alice'), 0);
});

test('createLoginThrottle reset clears a blocked username', () => {
  const throttle = createLoginThrottle({ maxAttempts: 1, windowMs: 60_000 });
  throttle.recordFailure('alice');
  assert.equal(throttle.isBlocked('alice'), true);
  throttle.reset('alice');
  assert.equal(throttle.isBlocked('alice'), false);
});

/** In-memory stand-in for the on-disk throttle store. */
function memoryStore(initial = []) {
  let saved = initial;
  return {
    load: () => saved,
    save: (entries) => {
      saved = entries.map(([k, v]) => [k, { ...v }]);
    },
    peek: () => saved,
  };
}

test('createLoginThrottle restores counters from its store', () => {
  const now = 1000;
  const store = memoryStore([['alice', { count: 3, first: now }]]);
  const throttle = createLoginThrottle({
    maxAttempts: 3,
    windowMs: 60_000,
    now: () => now,
    store,
  });
  // A host restart must not hand an attacker a fresh budget.
  assert.equal(throttle.isBlocked('alice'), true);
});

test('createLoginThrottle writes through to its store on failure and reset', () => {
  const store = memoryStore();
  const throttle = createLoginThrottle({ maxAttempts: 5, windowMs: 60_000, store });

  throttle.recordFailure('alice');
  assert.equal(store.peek().length, 1);
  assert.equal(store.peek()[0][0], 'alice');

  throttle.reset('alice');
  assert.equal(store.peek().length, 0);
});

test('createLoginThrottle survives a store that throws on save', () => {
  const throttle = createLoginThrottle({
    store: {
      load: () => [],
      save: () => {
        throw new Error('disk full');
      },
    },
  });
  // Persistence is best-effort; it must never break the login path.
  assert.doesNotThrow(() => throttle.recordFailure('alice'));
  assert.equal(throttle.isBlocked('alice'), false);
});

test('createThrottleStore round-trips entries', () => {
  let written = null;
  const store = createThrottleStore({
    file: 'C:\\fake\\throttle.json',
    windowMs: 60_000,
    now: () => 1000,
    fs: {
      existsSync: () => written !== null,
      readFileSync: () => written,
      writeFileSync: (_f, data) => {
        written = data;
      },
      mkdirSync: () => {},
    },
  });

  store.save([['alice', { count: 2, first: 1000 }]]);
  assert.deepEqual(store.load(), [['alice', { count: 2, first: 1000 }]]);
});

test('createThrottleStore drops entries older than the window on load', () => {
  const stale = JSON.stringify([
    { key: 'old', count: 9, first: 0 },
    { key: 'fresh', count: 1, first: 90_000 },
  ]);
  const store = createThrottleStore({
    file: 'C:\\fake\\throttle.json',
    windowMs: 60_000,
    now: () => 100_000,
    fs: {
      existsSync: () => true,
      readFileSync: () => stale,
      writeFileSync: () => {},
      mkdirSync: () => {},
    },
  });
  // Otherwise the file would grow forever and a stale counter could keep
  // blocking a legitimate login.
  assert.deepEqual(store.load(), [['fresh', { count: 1, first: 90_000 }]]);
});

test('createThrottleStore prunes expired entries when saving', () => {
  let written = null;
  const store = createThrottleStore({
    file: 'C:\\fake\\throttle.json',
    windowMs: 60_000,
    now: () => 100_000,
    fs: {
      existsSync: () => false,
      readFileSync: () => '',
      writeFileSync: (_f, data) => {
        written = data;
      },
      mkdirSync: () => {},
    },
  });
  store.save([
    ['old', { count: 9, first: 0 }],
    ['fresh', { count: 1, first: 90_000 }],
  ]);
  assert.deepEqual(JSON.parse(written), [{ key: 'fresh', count: 1, first: 90_000 }]);
});

test('createThrottleStore returns an empty list for a missing or corrupt file', () => {
  const make = (contents, exists = true) =>
    createThrottleStore({
      file: 'C:\\fake\\throttle.json',
      fs: {
        existsSync: () => exists,
        readFileSync: () => contents,
        writeFileSync: () => {},
        mkdirSync: () => {},
      },
    });

  assert.deepEqual(make('', false).load(), []);
  assert.deepEqual(make('not json').load(), []);
  assert.deepEqual(make('{"not":"an array"}').load(), []);
});

test('createThrottleStore never throws when the disk fails', () => {
  const store = createThrottleStore({
    file: 'C:\\fake\\throttle.json',
    fs: {
      existsSync: () => {
        throw new Error('EACCES');
      },
      readFileSync: () => '',
      writeFileSync: () => {
        throw new Error('EACCES');
      },
      mkdirSync: () => {},
    },
  });
  assert.deepEqual(store.load(), []);
  assert.doesNotThrow(() => store.save([['a', { count: 1, first: 0 }]]));
});
