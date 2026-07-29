import { BrowserBridgeError, BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { CommandState, isTerminalCommandState } from '../shared/protocol.mjs';

const TRANSITIONS = Object.freeze({
  [CommandState.QUEUED]: new Set([CommandState.AWAITING_APPROVAL, CommandState.DISPATCHED, CommandState.CANCELLED]),
  [CommandState.AWAITING_APPROVAL]: new Set([CommandState.DISPATCHED, CommandState.CANCELLED]),
  [CommandState.DISPATCHED]: new Set([CommandState.SUCCEEDED, CommandState.FAILED, CommandState.CANCELLED]),
  [CommandState.SUCCEEDED]: new Set(),
  [CommandState.FAILED]: new Set(),
  [CommandState.CANCELLED]: new Set(),
});

function invalid(message) {
  throw new BrowserBridgeError(BrowserBridgeErrorCode.INVALID_REQUEST, message);
}

function assertCommandId(commandId) {
  if (typeof commandId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(commandId)) {
    invalid('Invalid commandId');
  }
}

function assertGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 1) invalid('Invalid connectionGeneration');
}

export class BrowserBridgeState {
  #commands = new Map();
  #now;
  #commandTimeoutMs;
  #approvalTimeoutMs;

  constructor({ now = Date.now, commandTimeoutMs = 30_000, approvalTimeoutMs = 30_000 } = {}) {
    if (typeof now !== 'function') invalid('Invalid clock');
    if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 1) invalid('Invalid command timeout');
    if (!Number.isSafeInteger(approvalTimeoutMs) || approvalTimeoutMs < 1) invalid('Invalid approval timeout');
    this.#now = now;
    this.#commandTimeoutMs = commandTimeoutMs;
    this.#approvalTimeoutMs = approvalTimeoutMs;
  }

  createCommand({ commandId, connectionGeneration, tabId = null, tool }) {
    assertCommandId(commandId);
    assertGeneration(connectionGeneration);
    if (tabId !== null && (typeof tabId !== 'string' || tabId.length === 0)) invalid('Invalid tabId');
    if (typeof tool !== 'string' || tool.length === 0) invalid('Invalid tool');

    const existing = this.#commands.get(commandId);
    if (existing) {
      if (
        existing.connectionGeneration !== connectionGeneration ||
        existing.tabId !== tabId ||
        existing.tool !== tool
      ) {
        invalid('Duplicate commandId has different data');
      }
      return existing;
    }

    const now = this.#now();
    const command = {
      commandId,
      connectionGeneration,
      tabId,
      tool,
      state: CommandState.QUEUED,
      createdAt: now,
      approvalDeadline: null,
      commandDeadline: null,
      result: undefined,
      cancelReason: undefined,
    };
    this.#commands.set(commandId, command);
    return command;
  }

  get(commandId) {
    const command = this.#commands.get(commandId);
    if (!command) invalid('Unknown commandId');
    return command;
  }

  requestApproval(commandId) {
    return this.#transition(commandId, CommandState.AWAITING_APPROVAL, {
      approvalDeadline: this.#now() + this.#approvalTimeoutMs,
    });
  }

  approve(commandId) {
    return this.#transition(commandId, CommandState.DISPATCHED, {
      commandDeadline: this.#now() + this.#commandTimeoutMs,
    });
  }

  dispatch(commandId) {
    return this.#transition(commandId, CommandState.DISPATCHED, {
      commandDeadline: this.#now() + this.#commandTimeoutMs,
    });
  }

  complete(commandId, result) {
    return this.#transition(commandId, CommandState.SUCCEEDED, { result });
  }

  fail(commandId, result) {
    return this.#transition(commandId, CommandState.FAILED, { result });
  }

  cancel(commandId, reason = 'cancelled') {
    return this.#transition(commandId, CommandState.CANCELLED, { cancelReason: reason });
  }

  expire() {
    const now = this.#now();
    const cancelled = [];
    for (const command of this.#commands.values()) {
      if (
        (command.state === CommandState.AWAITING_APPROVAL && now > command.approvalDeadline) ||
        (command.state === CommandState.DISPATCHED && now > command.commandDeadline)
      ) {
        cancelled.push(this.cancel(command.commandId, 'timeout'));
      }
    }
    return cancelled;
  }

  cancelForTab(tabId, reason = 'tab_unshared') {
    return this.#cancelWhere((command) => command.tabId === tabId, reason);
  }

  cancelForConnectionGeneration(currentGeneration, reason = 'connection_replaced') {
    assertGeneration(currentGeneration);
    return this.#cancelWhere((command) => command.connectionGeneration !== currentGeneration, reason);
  }

  #cancelWhere(predicate, reason) {
    const cancelled = [];
    for (const command of this.#commands.values()) {
      if (!isTerminalCommandState(command.state) && predicate(command)) {
        cancelled.push(this.cancel(command.commandId, reason));
      }
    }
    return cancelled;
  }

  #transition(commandId, nextState, patch) {
    const command = this.get(commandId);
    if (!TRANSITIONS[command.state].has(nextState)) {
      invalid(`Cannot transition ${command.state} to ${nextState}`);
    }
    command.state = nextState;
    Object.assign(command, patch);
    return command;
  }
}
