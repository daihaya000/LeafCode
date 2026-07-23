import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isHeadless,
  resetOpencodeRestartBudget,
  shouldRestartOpencode,
} from './index.js';

test('isHeadless returns true for OPENCODE_HEADLESS=1', () => {
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  process.env.OPENCODE_HEADLESS = '1';
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true when --headless flag is present', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  process.argv = ['node', 'src/index.js', '--headless'];
  try {
    assert.equal(isHeadless(), true);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns false by default', () => {
  const previousArgv = process.argv;
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  delete process.env.OPENCODE_WEBUI_HEADLESS;
  process.argv = ['node', 'src/index.js'];
  try {
    assert.equal(isHeadless(), false);
  } finally {
    process.argv = previousArgv;
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('isHeadless returns true for OPENCODE_WEBUI_HEADLESS=1', () => {
  const previousHeadless = process.env.OPENCODE_HEADLESS;
  const previousWebuiHeadless = process.env.OPENCODE_WEBUI_HEADLESS;
  delete process.env.OPENCODE_HEADLESS;
  process.env.OPENCODE_WEBUI_HEADLESS = '1';
  try {
    assert.equal(isHeadless(), true);
  } finally {
    if (previousHeadless === undefined) delete process.env.OPENCODE_HEADLESS;
    else process.env.OPENCODE_HEADLESS = previousHeadless;
    if (previousWebuiHeadless === undefined)
      delete process.env.OPENCODE_WEBUI_HEADLESS;
    else process.env.OPENCODE_WEBUI_HEADLESS = previousWebuiHeadless;
  }
});

test('shouldRestartOpencode returns false when restart budget exhausted', () => {
  resetOpencodeRestartBudget();
  assert.equal(shouldRestartOpencode(0), true);
  assert.equal(shouldRestartOpencode(1), true);
  assert.equal(shouldRestartOpencode(2), true);
  assert.equal(shouldRestartOpencode(3), false);
});

test('shouldRestartOpencode resets after 5 minutes', () => {
  resetOpencodeRestartBudget();
  assert.equal(shouldRestartOpencode(0), true);
  assert.equal(shouldRestartOpencode(1), true);
  assert.equal(shouldRestartOpencode(2), true);
  assert.equal(shouldRestartOpencode(3), false);
  assert.equal(shouldRestartOpencode(5 * 60 * 1000), true);
});
