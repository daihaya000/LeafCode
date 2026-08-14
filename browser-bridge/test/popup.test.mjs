import assert from 'node:assert/strict';
import test from 'node:test';
import { render, showError } from '../extension/popup.mjs';

const ELEMENT_IDS = ['status', 'status-dot', 'status-text', 'connect-section', 'share', 'auto-share', 'tabs', 'tabs-heading', 'tabs-empty', 'revoke'];

function createFakeElement(id) {
  return {
    id,
    textContent: '',
    disabled: false,
    checked: false,
    hidden: false,
    className: '',
    value: '',
    children: [],
    replaceChildren(...items) { this.children = items; },
  };
}

function createFakeDocument() {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, createFakeElement(id)]));
  return {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: () => ({
      textContent: '',
      className: '',
      title: '',
      onclick: null,
      children: [],
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      append(...items) { this.children.push(...items); },
    }),
  };
}

function setup() {
  const document = createFakeDocument();
  globalThis.document = document;
  return document;
}

test('render reflects a fully connected, paired state with a shared tab', () => {
  const document = setup();
  render({ connected: true, paired: true, autoShareEnabled: true, sharedTabs: [{ id: 'tab_1', origin: 'https://example.test', title: 'Example' }] });
  assert.equal(document.getElementById('status-text').textContent, 'ローカル Broker に接続済み');
  assert.equal(document.getElementById('status-dot').className, 'status-dot is-connected');
  assert.equal(document.getElementById('connect-section').hidden, true);
  assert.equal(document.getElementById('share').disabled, false);
  assert.equal(document.getElementById('auto-share').disabled, false);
  assert.equal(document.getElementById('auto-share').checked, true);
  assert.equal(document.getElementById('revoke').disabled, false);
  assert.equal(document.getElementById('tabs-empty').hidden, true);
  assert.equal(document.getElementById('tabs-heading').textContent, '共有中のタブ (1)');
});

test('render shows the pairing form and disables tab controls before pairing', () => {
  const document = setup();
  render({ connected: false, paired: false, autoShareEnabled: false, sharedTabs: [] });
  assert.equal(document.getElementById('status-text').textContent, '未ペアリング');
  assert.equal(document.getElementById('status-dot').className, 'status-dot is-disconnected');
  assert.equal(document.getElementById('connect-section').hidden, false);
  assert.equal(document.getElementById('share').disabled, true);
  assert.equal(document.getElementById('auto-share').disabled, true);
  assert.equal(document.getElementById('revoke').disabled, true);
  assert.equal(document.getElementById('tabs-empty').hidden, false);
  assert.equal(document.getElementById('tabs-heading').textContent, '共有中のタブ');
});

test('render shows a reconnecting state once paired but not yet connected, and hides the pairing form', () => {
  const document = setup();
  render({ connected: false, paired: true, autoShareEnabled: false, sharedTabs: [] });
  assert.equal(document.getElementById('status-text').textContent, 'ペアリング済み・再接続中…');
  assert.equal(document.getElementById('status-dot').className, 'status-dot is-pending');
  assert.equal(document.getElementById('connect-section').hidden, true);
});

test('render shows a waiting-for-approval state while a pairing request is pending in the WebUI, with no code to type', () => {
  const document = setup();
  render({ connected: false, paired: false, pairingRequested: true, autoShareEnabled: false, sharedTabs: [] });
  assert.equal(document.getElementById('status-text').textContent, 'LeafCode での承認を待っています…');
  assert.equal(document.getElementById('status-dot').className, 'status-dot is-pending');
  assert.equal(document.getElementById('connect-section').hidden, false);
  assert.equal(document.getElementById('share').disabled, true);
  assert.equal(document.getElementById('revoke').disabled, true);
});

test('each shared tab row shows its title (falling back to origin) with a short stop button carrying the full context as an aria-label', () => {
  const document = setup();
  render({ connected: true, paired: true, autoShareEnabled: false, sharedTabs: [{ id: 'tab_1', origin: 'https://a.test', title: 'A' }, { id: 'tab_2', origin: 'https://b.test', title: '' }] });
  const items = document.getElementById('tabs').children;
  assert.equal(items.length, 2);

  const [title1, stop1] = items[0].children;
  assert.equal(title1.textContent, 'A');
  assert.equal(stop1.textContent, '停止');
  assert.equal(stop1.getAttribute('aria-label'), '「A」の共有を停止');

  const [title2, stop2] = items[1].children;
  assert.equal(title2.textContent, 'https://b.test');
  assert.equal(stop2.getAttribute('aria-label'), '「https://b.test」の共有を停止');
});

test('showError marks the status dot as errored and surfaces the message', () => {
  const document = setup();
  showError(new Error('boom'));
  assert.equal(document.getElementById('status-dot').className, 'status-dot is-error');
  assert.equal(document.getElementById('status-text').textContent, 'boom');
});
