import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebLaunchPlan, webRestartDelay } from './web-runtime.js';

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
