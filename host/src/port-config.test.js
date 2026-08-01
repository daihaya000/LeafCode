import assert from 'node:assert/strict';
import test from 'node:test';
import { readPort } from './port-config.js';

test('readPort accepts only integer TCP ports in range', () => {
  assert.equal(readPort('4096', 3000), 4096);
  assert.equal(readPort(' 3000 ', 4096), 3000);
  for (const value of ['', undefined, null, '0', '-1', '65536', '3000.5', 'abc', '1e3']) {
    assert.equal(readPort(value, 3000), 3000, `expected fallback for ${String(value)}`);
  }
});

test('readPort rejects an invalid fallback', () => {
  assert.throws(() => readPort('3000', 0), /Invalid fallback port/);
  assert.throws(() => readPort('3000', 65_536), /Invalid fallback port/);
});
