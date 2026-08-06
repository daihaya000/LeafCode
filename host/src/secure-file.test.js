import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetIcaclsCache, restrictToCurrentUser, writeSecretFile } from './secure-file.js';

test.beforeEach(() => {
  resetIcaclsCache();
});

test('writeSecretFile creates parent directories and writes the contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-secure-'));
  try {
    const file = join(dir, 'nested', 'deep', 'secret.json');
    writeSecretFile(file, '{"a":1}');
    assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restrictToCurrentUser is a no-op off Windows', () => {
  let called = false;
  const applied = restrictToCurrentUser('C:\\whatever.json', {
    platform: 'linux',
    execFile: () => {
      called = true;
    },
  });
  assert.equal(applied, false);
  assert.equal(called, false);
});

test('restrictToCurrentUser breaks inheritance and re-grants owner, SYSTEM and Administrators', () => {
  let args = null;
  restrictToCurrentUser('C:\\secret.json', {
    platform: 'win32',
    execFile: (file, argv) => {
      args = { file, argv };
    },
  });

  assert.equal(args.file, 'icacls');
  // Without /inheritance:r, icacls cannot remove inherited ACEs and silently
  // leaves the file readable by whatever the parent directory grants.
  assert.ok(args.argv.includes('/inheritance:r'));
  // Breaking inheritance drops SYSTEM/Administrators, so they must come back.
  assert.ok(args.argv.some((a) => a.includes('S-1-5-18')));
  assert.ok(args.argv.some((a) => a.includes('S-1-5-32-544')));
});

test('restrictToCurrentUser grants the owner delete rights', () => {
  let args = null;
  restrictToCurrentUser('C:\\secret.json', {
    platform: 'win32',
    execFile: (file, argv) => {
      args = { file, argv };
    },
  });
  // Without D the containing directory can no longer be removed (EPERM),
  // which breaks uninstall and cleanup.
  assert.ok(args.argv.some((a) => /:\(R,W,D\)$/.test(a)));
});

test('restrictToCurrentUser qualifies the user with the domain when available', () => {
  const originalDomain = process.env.USERDOMAIN;
  const originalUser = process.env.USERNAME;
  process.env.USERDOMAIN = 'CORP';
  process.env.USERNAME = 'alice';
  try {
    let args = null;
    restrictToCurrentUser('C:\\secret.json', {
      platform: 'win32',
      execFile: (file, argv) => {
        args = { file, argv };
      },
    });
    assert.ok(args.argv.includes('CORP\\alice:(R,W,D)'));
  } finally {
    process.env.USERDOMAIN = originalDomain;
    process.env.USERNAME = originalUser;
  }
});

test('restrictToCurrentUser gives up when USERNAME is unset rather than granting everyone', () => {
  const originalUser = process.env.USERNAME;
  delete process.env.USERNAME;
  try {
    let called = false;
    const messages = [];
    const applied = restrictToCurrentUser('C:\\secret.json', {
      platform: 'win32',
      execFile: () => {
        called = true;
      },
      onError: (m) => messages.push(m),
    });
    assert.equal(applied, false);
    assert.equal(called, false);
    assert.match(messages[0], /USERNAME/);
  } finally {
    process.env.USERNAME = originalUser;
  }
});

test('restrictToCurrentUser reports an icacls failure without throwing', () => {
  const messages = [];
  const applied = restrictToCurrentUser('C:\\secret.json', {
    platform: 'win32',
    execFile: () => {
      throw new Error('icacls exploded');
    },
    onError: (m) => messages.push(m),
  });
  assert.equal(applied, false);
  assert.match(messages[0], /icacls exploded/);
});

test('restrictToCurrentUser stops spawning icacls after the first failure', () => {
  let calls = 0;
  const failing = {
    platform: 'win32',
    execFile: () => {
      calls += 1;
      throw new Error('nope');
    },
  };
  restrictToCurrentUser('C:\\a.json', failing);
  restrictToCurrentUser('C:\\b.json', failing);
  restrictToCurrentUser('C:\\c.json', failing);
  assert.equal(calls, 1, 'a broken icacls must not cost a process per write');
});

test('writeSecretFile still writes the file when the ACL cannot be applied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocw-secure-'));
  try {
    const file = join(dir, 'secret.json');
    writeSecretFile(file, '{"a":1}', {
      platform: 'win32',
      execFile: () => {
        throw new Error('nope');
      },
    });
    // Losing the ACL hardening must not lose the data.
    assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.platform === 'win32') {
  test('a real secured file is readable only by owner/SYSTEM/Administrators, and stays deletable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocw-secure-real-'));
    try {
      const secure = join(dir, 'secure.json');
      const plain = join(dir, 'plain.json');
      writeSecretFile(secure, '{"secret":true}');
      writeFileSync(plain, '{}', 'utf8');

      const aclOf = (f) => execFileSync('icacls', [f], { encoding: 'utf8' });
      const secureAcl = aclOf(secure);
      const plainAcl = aclOf(plain);

      // The guard against the earlier bug: /remove:g alone left these identical
      // because every ACE was inherited.
      assert.notEqual(
        secureAcl.replace(secure, ''),
        plainAcl.replace(plain, ''),
        'the secured file must not keep the inherited ACL',
      );
      // No inherited entries survive on the secured file.
      assert.equal(/\(I\)/.test(secureAcl), false, secureAcl);

      // Deletion must still work, or uninstall breaks.
      rmSync(dir, { recursive: true, force: true });
      assert.equal(existsSync(dir), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
