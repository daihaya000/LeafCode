import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHttpWaiter, procRunning } from './health.js';
import { createOpencodeUpgrader } from './opencode-upgrade.js';

test('procRunning is false for a missing or already-exited child', () => {
  assert.equal(procRunning(null), false);
  assert.equal(procRunning({ exitCode: 1, killed: false }), false);
  assert.equal(procRunning({ exitCode: null, killed: true }), false);
  assert.equal(procRunning({ exitCode: null, killed: false }), true);
});

test('waitForPortFree returns true immediately when the port is free', async () => {
  let slept = 0;
  const waiter = createHttpWaiter({
    isPortInUse: () => false,
    sleep: async () => {
      slept += 1;
    },
  });
  assert.equal(await waiter.waitForPortFree(3000), true);
  assert.equal(slept, 0);
});

test('createOpencodeUpgrader exposes findOpencode and upgradeOpencodeCli', () => {
  const upgrader = createOpencodeUpgrader({
    log: () => {},
    error: () => {},
    recordLog: () => {},
    repoRoot: 'C:\\repo',
  });
  assert.equal(typeof upgrader.findOpencode, 'function');
  assert.equal(typeof upgrader.upgradeOpencodeCli, 'function');
});

test('opencode-upgrade.js imports execSync used by findOpencode', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./opencode-upgrade.js', import.meta.url)),
    'utf8',
  );
  assert.match(
    src,
    /import\s*\{[^}]*\bexecSync\b[^}]*\}\s*from\s*['"]child_process['"]/,
    'findOpencode calls execSync("where.exe opencode"); missing import crashes spawn',
  );
});
