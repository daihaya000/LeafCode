import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, statSync } from 'fs';
import {
  listUsers,
  verifyUser,
  upsertUser,
  deleteUser,
  hasUsers,
  validateUserInput,
} from './auth-store.js';

const BACKUP = process.env.AUTH_STORE_TEST_DATA_DIR;
const TEST_DIR = process.env.AUTH_STORE_TEST_DATA_DIR || 'C:\\tmp-auth-store-test-' + Date.now();

function withTestDir(fn) {
  const originalAppData = process.env.APPDATA;
  process.env.APPDATA = TEST_DIR;
  try {
    return fn();
  } finally {
    process.env.APPDATA = originalAppData;
  }
}

function clearUsersFile() {
  try {
    rmSync(TEST_DIR + '\\opencode-webui\\users.json', { force: true });
  } catch {
    // ignore
  }
}

function ensureClean() {
  if (existsSync(TEST_DIR + '\\opencode-webui')) {
    rmSync(TEST_DIR + '\\opencode-webui', { recursive: true, force: true });
  }
}

if (!BACKUP) {
  ensureClean();
}

test.beforeEach(() => {
  ensureClean();
});

test.after(() => {
  if (!BACKUP) ensureClean();
});

test('listUsers is empty initially', () => {
  withTestDir(() => {
    assert.deepEqual(listUsers(), []);
    assert.equal(hasUsers(), false);
  });
});

test('upsertUser creates a user', () => {
  withTestDir(() => {
    const result = upsertUser('Alice', 'secret-password');
    assert.equal(result.ok, true);
    const users = listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'Alice');
    assert.ok(users[0].updatedAt);
  });
});

test('verifyUser succeeds with correct password', () => {
  withTestDir(() => {
    upsertUser('Alice', 'secret-password');
    assert.equal(verifyUser('Alice', 'secret-password'), true);
  });
});

test('verifyUser rejects wrong password', () => {
  withTestDir(() => {
    upsertUser('Alice', 'secret-password');
    assert.equal(verifyUser('Alice', 'wrong-password'), false);
    assert.equal(verifyUser('Bob', 'secret-password'), false);
  });
});

test('upsertUser updates an existing password', () => {
  withTestDir(() => {
    upsertUser('Alice', 'old-password');
    upsertUser('Alice', 'new-password');
    assert.equal(verifyUser('Alice', 'old-password'), false);
    assert.equal(verifyUser('Alice', 'new-password'), true);
  });
});

test('deleteUser removes a user', () => {
  withTestDir(() => {
    upsertUser('Alice', 'secret-password');
    const removed = deleteUser('Alice');
    assert.equal(removed.ok, true);
    assert.equal(hasUsers(), false);
    assert.equal(verifyUser('Alice', 'secret-password'), false);
  });
});

test('deleteUser reports not found', () => {
  withTestDir(() => {
    const result = deleteUser('Nobody');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'user not found');
  });
});

test('username normalization for case/whitespace', () => {
  withTestDir(() => {
    upsertUser('  Alice  ', 'secret-password');
    assert.equal(verifyUser('alice', 'secret-password'), true);
    assert.equal(verifyUser('ALICE', 'secret-password'), true);
    assert.equal(verifyUser('  alice  ', 'secret-password'), true);
  });
});

test('invalid inputs are rejected', () => {
  withTestDir(() => {
    assert.equal(upsertUser('', 'password').ok, false);
    assert.equal(upsertUser('user', '123').ok, false);
    assert.equal(validateUserInput('', 'password').ok, false);
    assert.equal(validateUserInput('user', '123').ok, false);
    assert.equal(verifyUser('', 'password'), false);
    assert.equal(verifyUser('user', ''), false);
  });
});

test('file mode is 0o600', () => {
  withTestDir(() => {
    upsertUser('Alice', 'secret-password');
    const mode = statSync(TEST_DIR + '\\opencode-webui\\users.json').mode;
    // Windows does not have POSIX mode bits; skip on non-Windows.
    if (process.platform !== 'win32') {
      assert.equal(mode & 0o777, 0o600);
    }
  });
});
