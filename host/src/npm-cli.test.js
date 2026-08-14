import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnNpm, __resetNpmCliCacheForTest } from './npm-cli.js';

const FAKE_NPM_CLI = 'C:\\fake\\node\\node_modules\\npm\\bin\\npm-cli.js';

test('spawnNpm spawns node with the npm-cli.js path and passthrough args', () => {
  __resetNpmCliCacheForTest();
  const originalNpmExecpath = process.env.npm_execpath;
  process.env.npm_execpath = FAKE_NPM_CLI;
  const spawned = [];
  try {
    const child = spawnNpm(
      ['install', '--no-audit'],
      { cwd: 'C:\\app' },
      {
        existsSync: (p) => p === FAKE_NPM_CLI,
        execFileSync: () => '',
        spawn: (file, args, options) => {
          spawned.push({ file, args, options });
          return { on: () => undefined, once: () => undefined };
        },
      },
    );
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].file, process.execPath);
    assert.deepEqual(spawned[0].args, [FAKE_NPM_CLI, 'install', '--no-audit']);
    assert.equal(spawned[0].options.shell, false);
    assert.equal(spawned[0].options.cwd, 'C:\\app');
    assert.equal(typeof child.on, 'function');
  } finally {
    process.env.npm_execpath = originalNpmExecpath;
    __resetNpmCliCacheForTest();
  }
});

test('spawnNpm falls back to the where.exe scan when npm_execpath is unset', () => {
  __resetNpmCliCacheForTest();
  const originalNpmExecpath = process.env.npm_execpath;
  process.env.npm_execpath = undefined;
  const spawned = [];
  const whereResult = 'C:\\Program Files\\nodejs\\npm.cmd\r\n';
  try {
    spawnNpm(
      ['--version'],
      {},
      {
        existsSync: (p) => p.includes('Program Files'),
        execFileSync: () => whereResult,
        spawn: (file, args, options) => {
          spawned.push({ file, args, options });
          return { on: () => undefined, once: () => undefined };
        },
      },
    );
    assert.equal(spawned.length, 1);
    assert.equal(
      spawned[0].args[0],
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    );
    assert.deepEqual(spawned[0].args.slice(1), ['--version']);
  } finally {
    process.env.npm_execpath = originalNpmExecpath;
    __resetNpmCliCacheForTest();
  }
});

test('spawnNpm throws a clear error when no npm-cli.js exists', () => {
  __resetNpmCliCacheForTest();
  const originalNpmExecpath = process.env.npm_execpath;
  process.env.npm_execpath = undefined;
  try {
    assert.throws(
      () =>
        spawnNpm(
          ['--version'],
          {},
          { existsSync: () => false, execFileSync: () => '' },
        ),
      /npm-cli\.js was not found/,
    );
  } finally {
    process.env.npm_execpath = originalNpmExecpath;
    __resetNpmCliCacheForTest();
  }
});
