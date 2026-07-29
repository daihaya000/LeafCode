import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { BrowserToolName } from '../shared/protocol.mjs';
import { BrowserBridgeClient, readBrokerEnvironment } from '../mcp/broker-client.mjs';
import { createMcpServer } from '../mcp/server.mjs';

test('requires a loopback Broker URL and a non-empty host-issued credential', () => {
  assert.throws(() => readBrokerEnvironment({}), /credential/i);
  assert.throws(
    () => readBrokerEnvironment({
      OPENCODE_WEBUI_BROWSER_BROKER: 'https://broker.example.test',
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: 'x'.repeat(32),
    }),
    /loopback/i,
  );
  assert.deepEqual(
    readBrokerEnvironment({
      OPENCODE_WEBUI_BROWSER_BROKER: 'http://127.0.0.1:18766/',
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: 'x'.repeat(32),
    }),
    { baseUrl: 'http://127.0.0.1:18766', token: 'x'.repeat(32) },
  );
});

test('Broker client validates shared tool schemas and sanitizes unavailable responses', async () => {
  const requests = [];
  const client = new BrowserBridgeClient({
    baseUrl: 'http://127.0.0.1:18766',
    token: 'x'.repeat(32),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ error: { code: BrowserBridgeErrorCode.EXTENSION_DISCONNECTED } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.call(BrowserToolName.SNAPSHOT, { tabId: 'tab_1', selector: 'body' }),
    (error) => error.code === BrowserBridgeErrorCode.INVALID_REQUEST,
  );
  await assert.rejects(
    () => client.call(BrowserToolName.STATUS, {}),
    (error) => error.code === BrowserBridgeErrorCode.EXTENSION_DISCONNECTED,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:18766/internal/tools/browser_status');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'x'.repeat(32)}`);
});

test('Broker client generalizes malformed and unknown Broker errors', async () => {
  const client = new BrowserBridgeClient({
    baseUrl: 'http://127.0.0.1:18766',
    token: 'x'.repeat(32),
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'INTERNAL_STACK_TRACE', detail: 'secret' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(
    () => client.call(BrowserToolName.STATUS, {}),
    (error) => error.code === BrowserBridgeErrorCode.BROKER_UNAVAILABLE && !error.message.includes('secret'),
  );
  const malformed = new BrowserBridgeClient({
    baseUrl: 'http://127.0.0.1:18766',
    token: 'x'.repeat(32),
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => malformed.call(BrowserToolName.STATUS, {}),
    (error) => error.code === BrowserBridgeErrorCode.BROKER_UNAVAILABLE,
  );
});

test('registers only read tools and maps Broker errors without leaking internals', async (t) => {
  const calls = [];
  const server = createMcpServer({
    brokerClient: {
      async call(tool, args) {
        calls.push({ tool, args });
        if (tool === BrowserToolName.SNAPSHOT) {
          const error = new Error('connection refused at http://127.0.0.1:18766/secret');
          error.code = BrowserBridgeErrorCode.BROKER_UNAVAILABLE;
          throw error;
        }
        if (tool === BrowserToolName.SCREENSHOT) {
          return { image: { mimeType: 'image/png', data: 'aGVsbG8=' } };
        }
        return tool === BrowserToolName.STATUS
          ? { extension: { connected: true, paired: true }, pendingApprovals: 0 }
          : { tabs: [] };
      },
    },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    'browser_list_tabs',
    'browser_navigate',
    'browser_screenshot',
    'browser_scroll',
    'browser_snapshot',
    'browser_status',
    'browser_type',
  ]);
  assert.ok(listed.tools.filter((tool) => !['browser_type', 'browser_scroll', 'browser_navigate', 'browser_screenshot'].includes(tool.name)).every((tool) => tool.annotations?.readOnlyHint === true));
  assert.equal(listed.tools.find((tool) => tool.name === 'browser_type')?.annotations?.readOnlyHint, false);
  assert.equal(listed.tools.find((tool) => tool.name === 'browser_scroll')?.annotations?.readOnlyHint, false);
  assert.equal(listed.tools.find((tool) => tool.name === 'browser_navigate')?.annotations?.readOnlyHint, false);
  assert.equal(listed.tools.find((tool) => tool.name === 'browser_screenshot')?.annotations?.readOnlyHint, false);

  const status = await client.callTool({ name: BrowserToolName.STATUS, arguments: {} });
  assert.equal(status.isError, undefined);
  assert.equal(status.content[0].type, 'text');
  assert.match(status.content[0].text, /connected/);

  const failed = await client.callTool({ name: BrowserToolName.SNAPSHOT, arguments: { tabId: 'tab_1' } });
  assert.equal(failed.isError, true);
  assert.deepEqual(JSON.parse(failed.content[0].text), { error: { code: BrowserBridgeErrorCode.BROKER_UNAVAILABLE } });
  assert.doesNotMatch(failed.content[0].text, /127\.0\.0\.1|secret|refused/);
  assert.deepEqual(calls[1], { tool: BrowserToolName.SNAPSHOT, args: { tabId: 'tab_1' } });

  const screenshot = await client.callTool({ name: BrowserToolName.SCREENSHOT, arguments: { tabId: 'tab_1' } });
  assert.deepEqual(screenshot.content, [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }]);
});
