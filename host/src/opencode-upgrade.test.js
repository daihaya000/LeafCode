import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  repairNpmOpencodeStub,
  createOpencodeUpgrader,
  readUpgradeState,
  writeUpgradeState,
} from './opencode-upgrade.js';

function tempStateFile() {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-upgrade-test-'));
  return { dir, stateFile: join(dir, 'state.json') };
}

const HOUR = 3_600_000;

function withCleanUpgradeEnv(fn) {
  const autoUpdate = process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
  const cooldownHours = process.env.LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS;
  delete process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
  delete process.env.LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS;
  try {
    return fn();
  } finally {
    if (autoUpdate !== undefined) process.env.LEAFCODE_AUTO_UPDATE_OPENCODE = autoUpdate;
    else delete process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
    if (cooldownHours !== undefined) {
      process.env.LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS = cooldownHours;
    } else {
      delete process.env.LEAFCODE_OPENCODE_UPGRADE_COOLDOWN_HOURS;
    }
  }
}

test('repairNpmOpencodeStub returns null for a real PE exe (nothing to fix)', () => {
  const result = repairNpmOpencodeStub('C:\\opencode\\opencode.exe', {
    existsSync: (p) => p.includes('postinstall.mjs'),
    isPe: () => true,
  });
  assert.equal(result, null);
});

test('repairNpmOpencodeStub returns null for a missing postinstall script', () => {
  const result = repairNpmOpencodeStub('C:\\opencode\\opencode.cmd', {
    existsSync: () => false,
    isPe: () => false,
  });
  assert.equal(result, null);
});

test('repairNpmOpencodeStub runs postinstall and returns the repaired exe', () => {
  const ranPostinstall = [];
  // The stub is not a PE before postinstall; after it runs it becomes one.
  let repaired = false;
  const result = repairNpmOpencodeStub('C:\\pkg\\opencode-ai\\opencode.cmd', {
    existsSync: (p) => p.endsWith('postinstall.mjs'),
    isPe: () => repaired,
    runPostinstall: (pkgDir) => {
      ranPostinstall.push(pkgDir);
      repaired = true;
    },
  });
  assert.equal(
    result,
    'C:\\pkg\\opencode-ai\\node_modules\\opencode-ai\\bin\\opencode.exe',
  );
  assert.deepEqual(ranPostinstall, ['C:\\pkg\\opencode-ai\\node_modules\\opencode-ai']);
});

test('repairNpmOpencodeStub returns null when postinstall fails', () => {
  const result = repairNpmOpencodeStub('C:\\pkg\\opencode.cmd', {
    existsSync: () => true,
    isPe: () => false,
    runPostinstall: () => {
      throw new Error('postinstall failed');
    },
  });
  assert.equal(result, null);
});

test('upgradeOpencodeCli skips when auto-update is disabled', async () => {
  const previous = process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
  process.env.LEAFCODE_AUTO_UPDATE_OPENCODE = '0';
  const logs = [];
  try {
    const upgrader = createOpencodeUpgrader({
      log: (m) => logs.push(m),
      error: () => {},
    });
    const result = await upgrader.upgradeOpencodeCli();
    assert.deepEqual(result, { upgraded: false, version: null });
    assert.ok(logs.some((l) => l.includes('auto-update is disabled')));
  } finally {
    process.env.LEAFCODE_AUTO_UPDATE_OPENCODE = previous;
  }
});

test('upgradeOpencodeCli skips with a logged error when opencode is not found', async () => {
  const previous = process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
  const previousPath = process.env.PATH;
  delete process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
  process.env.PATH = 'C:\\nonexistent-for-test';
  const errors = [];
  try {
    const upgrader = createOpencodeUpgrader({
      log: () => {},
      error: (m) => errors.push(m),
    });
    const result = await upgrader.upgradeOpencodeCli();
    assert.deepEqual(result, { upgraded: false, version: null });
    assert.ok(errors.some((e) => e.includes('auto-update skipped')));
  } finally {
    if (previous !== undefined) process.env.LEAFCODE_AUTO_UPDATE_OPENCODE = previous;
    else delete process.env.LEAFCODE_AUTO_UPDATE_OPENCODE;
    process.env.PATH = previousPath;
  }
});

test('readUpgradeState / writeUpgradeState roundtrip and tolerate corruption', () => {
  const { dir, stateFile } = tempStateFile();
  try {
    assert.equal(readUpgradeState(stateFile), null);
    writeUpgradeState(stateFile, 123456789);
    assert.deepEqual(readUpgradeState(stateFile), { lastCheckAt: 123456789 });
    rmSync(stateFile);
    writeUpgradeState(stateFile, 42, { writeFileSync: () => {} });
    assert.equal(existsSync(stateFile), false, 'injected io replaces the real write');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeOpencodeCli skips the probe when the previous start checked within the cooldown', async () => {
  const { dir, stateFile } = tempStateFile();
  const logs = [];
  const calls = { find: 0, upgrade: 0 };
  await withCleanUpgradeEnv(async () => {
    try {
      writeUpgradeState(stateFile, Date.now() - 60_000);
      const upgrader = createOpencodeUpgrader({
        stateFile,
        log: (m) => logs.push(m),
        error: () => {},
        findOpencode: () => {
          calls.find += 1;
          return 'C:\\opencode.exe';
        },
        runOpencodeUpgrade: () => {
          calls.upgrade += 1;
          return Promise.resolve({ ok: true });
        },
      });
      const result = await upgrader.upgradeOpencodeCli();
      assert.deepEqual(result, { upgraded: false, version: null, skipped: true });
      assert.equal(calls.find, 0, 'CLI discovery must not run on the skip path');
      assert.equal(calls.upgrade, 0, 'the upgrade probe must not spawn');
      assert.ok(logs.some((l) => l.includes('auto-update skipped') && l.includes('cooldown')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('upgradeOpencodeCli runs and stamps the state after a successful check', async () => {
  const { dir, stateFile } = tempStateFile();
  let clock = 1_000_000_000;
  const calls = { find: 0, upgrade: 0 };
  await withCleanUpgradeEnv(async () => {
    try {
      // Last check 25 h ago: outside the default 24 h cooldown.
      writeUpgradeState(stateFile, clock - 25 * HOUR);
      const upgrader = createOpencodeUpgrader({
        stateFile,
        now: () => clock,
        log: () => {},
        error: () => {},
        findOpencode: () => {
          calls.find += 1;
          return 'C:\\opencode.exe';
        },
        runOpencodeUpgrade: () => {
          calls.upgrade += 1;
          return Promise.resolve({ ok: true });
        },
      });
      const result = await upgrader.upgradeOpencodeCli();
      assert.equal(result.upgraded, true);
      assert.equal(calls.upgrade, 1);
      // State stamped with the check time; a next start within the cooldown skips.
      assert.deepEqual(readUpgradeState(stateFile), { lastCheckAt: clock });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('upgradeOpencodeCli does not stamp the state when the upgrade fails', async () => {
  const { dir, stateFile } = tempStateFile();
  await withCleanUpgradeEnv(async () => {
    try {
      const upgrader = createOpencodeUpgrader({
        stateFile,
        log: () => {},
        error: () => {},
        findOpencode: () => 'C:\\opencode.exe',
        runOpencodeUpgrade: () => Promise.resolve({ ok: false, message: 'network down' }),
      });
      const result = await upgrader.upgradeOpencodeCli();
      assert.deepEqual(result, { upgraded: false, version: null });
      assert.equal(
        existsSync(stateFile),
        false,
        'a failed probe must not stamp the state, so the next start retries',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
