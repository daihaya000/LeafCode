import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProcessCommandLine,
  getProcessCreationTime,
  hasTrayChild,
  looksLikeHostCommandLine,
  stronglyLooksLikeHostCommandLine,
} from './process-info.js';

test('getProcessCommandLine returns the trimmed command line', () => {
  assert.equal(
    getProcessCommandLine(123, {
      runPowerShell: () => ' "C:\\node.exe" "C:\\src\\index.js" \r\n',
    }),
    '"C:\\node.exe" "C:\\src\\index.js"',
  );
});

test('getProcessCommandLine returns null for an empty result', () => {
  assert.equal(
    getProcessCommandLine(123, { runPowerShell: () => '   ' }),
    null,
  );
});

test('getProcessCommandLine returns null when the query throws', () => {
  assert.equal(
    getProcessCommandLine(123, {
      runPowerShell: () => {
        throw new Error('CIM unavailable');
      },
    }),
    null,
  );
});

test('getProcessCreationTime returns a numeric FILETIME or null', () => {
  assert.equal(
    getProcessCreationTime(123, {
      runPowerShell: () => '133300000000000000',
    }),
    '133300000000000000',
  );
  assert.equal(
    getProcessCreationTime(123, { runPowerShell: () => 'not a number' }),
    null,
  );
  assert.equal(
    getProcessCreationTime(123, {
      runPowerShell: () => {
        throw new Error('down');
      },
    }),
    null,
  );
});

test('hasTrayChild counts tray_windows children', () => {
  assert.equal(hasTrayChild(10, { runPowerShell: () => '2' }), true);
  assert.equal(hasTrayChild(10, { runPowerShell: () => '0' }), false);
  assert.equal(
    hasTrayChild(10, {
      runPowerShell: () => {
        throw new Error('down');
      },
    }),
    null,
  );
});

test('looksLikeHostCommandLine matches node src/index.js', () => {
  assert.equal(
    looksLikeHostCommandLine('"C:\\node.exe" "C:\\OpenCodeWebUI\\src\\index.js"'),
    true,
  );
  assert.equal(looksLikeHostCommandLine('C:\\python.exe script.py'), false);
});

test('stronglyLooksLikeHostCommandLine requires host or product reference', () => {
  assert.equal(
    stronglyLooksLikeHostCommandLine(
      '"C:\\node.exe" "C:\\OpenCodeWebUI\\host\\src\\index.js"',
    ),
    true,
  );
  assert.equal(
    stronglyLooksLikeHostCommandLine(
      '"C:\\node.exe" "C:\\OpenCodeWebUI\\src\\index.js"',
    ),
    false,
  );
});
