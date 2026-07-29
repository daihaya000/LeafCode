import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { CommandState } from '../shared/protocol.mjs';
import { BrowserBridgeState } from '../broker/state.mjs';

function createState() {
  let now = 1_000;
  return {
    state: new BrowserBridgeState({ now: () => now, commandTimeoutMs: 100, approvalTimeoutMs: 50 }),
    advance(ms) {
      now += ms;
    },
  };
}

test('moves approval commands through the only permitted states', () => {
  const { state } = createState();
  const command = state.createCommand({ commandId: 'cmd_1', connectionGeneration: 1, tool: 'browser_click' });
  assert.equal(command.state, CommandState.QUEUED);

  assert.equal(state.requestApproval('cmd_1').state, CommandState.AWAITING_APPROVAL);
  assert.equal(state.approve('cmd_1').state, CommandState.DISPATCHED);
  assert.equal(state.complete('cmd_1', { ok: true }).state, CommandState.SUCCEEDED);
  assert.throws(
    () => state.cancel('cmd_1', 'late'),
    (error) => error.code === BrowserBridgeErrorCode.INVALID_REQUEST,
  );
});

test('does not dispatch a duplicate command id twice', () => {
  const { state } = createState();
  const first = state.createCommand({ commandId: 'cmd_1', connectionGeneration: 1, tool: 'browser_scroll' });
  const duplicate = state.createCommand({ commandId: 'cmd_1', connectionGeneration: 1, tool: 'browser_scroll' });
  assert.equal(first, duplicate);
  assert.equal(state.dispatch('cmd_1').state, CommandState.DISPATCHED);
  assert.throws(
    () => state.dispatch('cmd_1'),
    (error) => error.code === BrowserBridgeErrorCode.INVALID_REQUEST,
  );
});

test('expires approval and dispatched commands without dispatching them later', () => {
  const { state, advance } = createState();
  state.createCommand({ commandId: 'approval', connectionGeneration: 1, tool: 'browser_type' });
  state.requestApproval('approval');
  advance(51);
  assert.deepEqual(state.expire().map((entry) => entry.commandId), ['approval']);
  assert.equal(state.get('approval').state, CommandState.CANCELLED);

  state.createCommand({ commandId: 'dispatch', connectionGeneration: 1, tool: 'browser_scroll' });
  state.dispatch('dispatch');
  advance(101);
  state.expire();
  assert.equal(state.get('dispatch').state, CommandState.CANCELLED);
});

test('cancels pending commands when tab ownership or connection generation changes', () => {
  const { state } = createState();
  state.createCommand({ commandId: 'old', connectionGeneration: 1, tabId: 'tab_a', tool: 'browser_click' });
  state.dispatch('old');
  state.createCommand({ commandId: 'other-tab', connectionGeneration: 2, tabId: 'tab_b', tool: 'browser_scroll' });
  state.dispatch('other-tab');

  assert.deepEqual(state.cancelForTab('tab_a', 'tab_unshared').map((entry) => entry.commandId), ['old']);
  assert.equal(state.get('old').state, CommandState.CANCELLED);
  assert.equal(state.get('other-tab').state, CommandState.DISPATCHED);

  assert.deepEqual(state.cancelForConnectionGeneration(3, 'connection_replaced').map((entry) => entry.commandId), ['other-tab']);
  assert.equal(state.get('other-tab').state, CommandState.CANCELLED);
});
