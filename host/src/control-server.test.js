import test from 'node:test';
import assert from 'node:assert/strict';
import { matchControlRoute } from './control-server.js';

test('matchControlRoute maps restart endpoints', () => {
  assert.equal(matchControlRoute('POST', '/restart/webui'), 'webui');
  assert.equal(matchControlRoute('POST', '/restart/opencode'), 'opencode');
  assert.equal(matchControlRoute('POST', '/restart/all'), 'all');
  assert.equal(matchControlRoute('POST', '/restart/webui/'), 'webui');
});

test('matchControlRoute exposes health and rejects unknowns', () => {
  assert.equal(matchControlRoute('GET', '/health'), 'health');
  assert.equal(matchControlRoute('GET', '/restart/webui'), null);
  assert.equal(matchControlRoute('POST', '/restart'), null);
  assert.equal(matchControlRoute('DELETE', '/restart/all'), null);
});
