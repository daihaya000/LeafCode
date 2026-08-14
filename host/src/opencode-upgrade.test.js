import test from 'node:test';
import assert from 'node:assert/strict';
import { repairNpmOpencodeStub, createOpencodeUpgrader } from './opencode-upgrade.js';

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
