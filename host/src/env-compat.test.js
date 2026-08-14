import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebuiEnv } from '../../scripts/lib/env-compat.mjs';

test('env-compat: legacy OPENCODE_WEBUI_* values are copied onto LEAFCODE_* names', () => {
  const env = {
    OPENCODE_WEBUI_PORT: '3999',
    OPENCODE_WEBUI_CADDY: '0',
    LEAFCODE_HOST: '0.0.0.0',
    NEXT_PUBLIC_OPENCODE_WEBUI_WORKFLOW_MODE: 'true',
  };
  normalizeWebuiEnv(env);
  assert.equal(env.LEAFCODE_PORT, '3999');
  assert.equal(env.LEAFCODE_CADDY, '0');
  assert.equal(env.NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE, 'true');
  // New name wins: an explicitly set LEAFCODE_HOST is never overwritten.
  assert.equal(env.LEAFCODE_HOST, '0.0.0.0');
  // Unrelated vars untouched.
  assert.equal(env.OPENCODE_BASE_URL, undefined);
  // Legacy keys are left in place (harmless, idempotent re-run).
  assert.equal(env.OPENCODE_WEBUI_PORT, '3999');
});

test('env-compat: new-name-only env is left alone', () => {
  const env = { LEAFCODE_PORT: '3001' };
  normalizeWebuiEnv(env);
  assert.equal(env.LEAFCODE_PORT, '3001');
  assert.equal(Object.keys(env).length, 1);
});

test('env-compat: idempotent across repeated calls', () => {
  const env = { OPENCODE_WEBUI_MODE: 'dev' };
  normalizeWebuiEnv(env);
  normalizeWebuiEnv(env);
  normalizeWebuiEnv(env);
  assert.equal(env.LEAFCODE_MODE, 'dev');
});
