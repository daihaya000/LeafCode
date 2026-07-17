import assert from 'node:assert/strict';
import test from 'node:test';
import { formatServiceStatus } from './service-status.js';

test('reports a healthy reused service as running', () => {
  assert.equal(formatServiceStatus('WebUI', false, true), 'WebUI: running');
});

test('distinguishes an owned starting service from a stopped service', () => {
  assert.equal(formatServiceStatus('WebUI', true, false), 'WebUI: starting…');
  assert.equal(formatServiceStatus('WebUI', false, false), 'WebUI: stopped');
});
