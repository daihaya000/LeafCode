import assert from 'node:assert/strict';
import test from 'node:test';
import { parseListeningPids } from './port-plan.js';

test('parseListeningPids matches exact port listeners only', () => {
  const output = `
  TCP         127.0.0.1:4096         0.0.0.0:0              LISTENING       40780
  TCP         127.0.0.1:40960        0.0.0.0:0              LISTENING       11111
  TCP         0.0.0.0:3000           0.0.0.0:0              LISTENING       22222
  TCP         127.0.0.1:4096         127.0.0.1:50240        ESTABLISHED     40780
  TCP         [::1]:4096             [::]:0                 LISTENING       33333
`;
  assert.deepEqual(parseListeningPids(output, 4096).sort((a, b) => a - b), [
    33333, 40780,
  ]);
  assert.deepEqual(parseListeningPids(output, 3000), [22222]);
  assert.deepEqual(parseListeningPids(output, 40960), [11111]);
  assert.deepEqual(parseListeningPids(output, 9999), []);
});
