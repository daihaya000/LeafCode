import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  getWebLaunchPlan,
  isWebBuildStale,
  webRestartDelay,
} from './web-runtime.js';

test('prod mode rebuilds when BUILD_ID is absent', () => {
  assert.deepEqual(getWebLaunchPlan('prod', false), {
    needsBuild: true,
    useProd: true,
  });
  assert.deepEqual(getWebLaunchPlan('prod', true), {
    needsBuild: false,
    useProd: true,
  });
});

test('prod mode rebuilds when BUILD_ID exists but sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan('prod', true, true), {
    needsBuild: true,
    useProd: true,
  });
  assert.deepEqual(getWebLaunchPlan('prod', true, false), {
    needsBuild: false,
    useProd: true,
  });
});

test('auto mode with existing build rebuilds when sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan(undefined, true, true), {
    needsBuild: true,
    useProd: true,
  });
});

test('dev mode never rebuilds for start, even when sources are newer', () => {
  assert.deepEqual(getWebLaunchPlan('dev', true, true), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan('dev', false, true), {
    needsBuild: false,
    useProd: false,
  });
});

test('dev and auto modes preserve their existing launch behavior', () => {
  assert.deepEqual(getWebLaunchPlan('dev', true), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan(undefined, false), {
    needsBuild: false,
    useProd: false,
  });
  assert.deepEqual(getWebLaunchPlan(undefined, true), {
    needsBuild: false,
    useProd: true,
  });
});

test('restart backoff is bounded', () => {
  assert.equal(webRestartDelay(1), 1000);
  assert.equal(webRestartDelay(3), 3000);
  assert.equal(webRestartDelay(99), 5000);
});

test('isWebBuildStale is false when BUILD_ID is missing', () => {
  assert.equal(
    isWebBuildStale('/web', {
      existsSync: () => false,
    }),
    false,
  );
});

test('isWebBuildStale is true when a watched source is newer than BUILD_ID', () => {
  const webDir = join('C:', 'web');
  const buildMs = Date.parse('2026-07-19T06:00:00.000Z');
  const sourceMs = Date.parse('2026-07-19T14:00:00.000Z');
  const files = new Map([
    [join(webDir, '.next', 'BUILD_ID'), { mtimeMs: buildMs }],
    [join(webDir, 'package.json'), { mtimeMs: buildMs }],
    [join(webDir, 'src', 'components', 'shell', 'Sidebar.tsx'), { mtimeMs: sourceMs }],
  ]);
  const dirs = new Map([
    [join(webDir, 'src'), ['components']],
    [join(webDir, 'src', 'components'), ['shell']],
    [join(webDir, 'src', 'components', 'shell'), ['Sidebar.tsx']],
  ]);

  assert.equal(
    isWebBuildStale(webDir, {
      existsSync: (p) => files.has(p) || dirs.has(p),
      statSync: (p) => {
        if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, mtimeMs: 0 };
        const entry = files.get(p);
        if (!entry) throw new Error(`missing ${p}`);
        return { isDirectory: () => false, isFile: () => true, mtimeMs: entry.mtimeMs };
      },
      readdirSync: (p) => dirs.get(p) ?? [],
    }),
    true,
  );
});

test('isWebBuildStale is false when sources are older than BUILD_ID', () => {
  const webDir = join('C:', 'web');
  const buildMs = Date.parse('2026-07-19T14:00:00.000Z');
  const sourceMs = Date.parse('2026-07-19T06:00:00.000Z');
  const files = new Map([
    [join(webDir, '.next', 'BUILD_ID'), { mtimeMs: buildMs }],
    [join(webDir, 'package.json'), { mtimeMs: sourceMs }],
    [join(webDir, 'src', 'app', 'page.tsx'), { mtimeMs: sourceMs }],
  ]);
  const dirs = new Map([
    [join(webDir, 'src'), ['app']],
    [join(webDir, 'src', 'app'), ['page.tsx']],
  ]);

  assert.equal(
    isWebBuildStale(webDir, {
      existsSync: (p) => files.has(p) || dirs.has(p),
      statSync: (p) => {
        if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, mtimeMs: 0 };
        const entry = files.get(p);
        if (!entry) throw new Error(`missing ${p}`);
        return { isDirectory: () => false, isFile: () => true, mtimeMs: entry.mtimeMs };
      },
      readdirSync: (p) => dirs.get(p) ?? [],
    }),
    false,
  );
});
