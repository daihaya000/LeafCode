import test from 'node:test';
import assert from 'node:assert/strict';

import { isHeadless } from './index.js';

test('isHeadless returns true for OPENCODE_HEADLESS=1', () => {
  const previous = process.env.OPENCODE_HEADLESS;
  process.env.OPENCODE_HEADLESS = '1';
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previous;
  }
});

test('isHeadless returns true when --headless flag is present', () => {
  const previousArgv = process.argv;
  const previous = process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  process.argv = ['node', 'src/index.js', '--headless'];
  try {
    assert.equal(isHeadless(), true);
  } finally {
    process.argv = previousArgv;
    if (previous === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previous;
  }
});

test('isHeadless returns false by default', () => {
  const previousArgv = process.argv;
  const previous = process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  process.argv = ['node', 'src/index.js'];
  try {
    assert.equal(isHeadless(), false);
  } finally {
    process.argv = previousArgv;
    if (previous === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previous;
  }
});
