import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import {
  isAdmin,
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

test('a newly created user is admin', () => {
  withTestDir(() => {
    upsertUser('Alice', 'secret-password');
    assert.equal(isAdmin('Alice'), true);
    assert.equal(listUsers()[0].role, 'admin');
  });
});

test('isAdmin is false for an unknown or invalid user', () => {
  withTestDir(() => {
    assert.equal(isAdmin('Nobody'), false);
    assert.equal(isAdmin(''), false);
  });
});

test('upsertUser preserves an existing role across a password change', () => {
  withTestDir(() => {
    upsertUser('Alice', 'old-password');
    // Simulate a demotion to a plain user, then confirm a later password
    // change does not silently promote them back to admin.
    const users = JSON.parse(readFileSync(TEST_DIR + '\\opencode-webui\\users.json', 'utf8'));
    users[0].role = 'user';
    writeFileSync(TEST_DIR + '\\opencode-webui\\users.json', JSON.stringify(users, null, 2), 'utf8');

    upsertUser('Alice', 'new-password');
    assert.equal(isAdmin('Alice'), false);
    assert.equal(listUsers()[0].role, 'user');
  });
});

test('a legacy users.json record with no role field is treated as admin', () => {
  withTestDir(() => {
    // Records written before the role field existed must not lose access.
    mkdirSync(TEST_DIR + '\\opencode-webui', { recursive: true });
    writeFileSync(
      TEST_DIR + '\\opencode-webui\\users.json',
      JSON.stringify([
        {
          username: 'Legacy',
          passwordHash: 'x',
          salt: 'y',
          updatedAt: new Date().toISOString(),
        },
      ]),
      'utf8',
    );
    assert.equal(isAdmin('Legacy'), true);
    assert.equal(listUsers()[0].role, 'admin');
  });
});

test('an unrecognised role value falls back to admin rather than locking everyone out', () => {
  withTestDir(() => {
    mkdirSync(TEST_DIR + '\\opencode-webui', { recursive: true });
    writeFileSync(
      TEST_DIR + '\\opencode-webui\\users.json',
      JSON.stringify([
        {
          username: 'Weird',
          passwordHash: 'x',
          salt: 'y',
          role: 'superuser',
          updatedAt: new Date().toISOString(),
        },
      ]),
      'utf8',
    );
    assert.equal(isAdmin('Weird'), true);
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
