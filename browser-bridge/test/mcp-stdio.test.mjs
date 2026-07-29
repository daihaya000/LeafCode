import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverScript = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));

test('stdio MCP initializes, lists tools, and keeps protocol stdout clean', async (t) => {
  const token = 'x'.repeat(32);
  const broker = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.url, '/internal/tools/browser_status');
    assert.equal(body, '{}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ extension: { connected: true, paired: true }, pendingApprovals: 0 }));
  });
  broker.listen(0, '127.0.0.1');
  await once(broker, 'listening');
  const port = broker.address().port;
  t.after(() => broker.close());

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCODE_WEBUI_BROWSER_BROKER: `http://127.0.0.1:${port}`,
      OPENCODE_WEBUI_BROWSER_BROKER_TOKEN: token,
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());

  const listed = await client.listTools();
  assert.equal(listed.tools.length, 7);
  const response = await client.callTool({ name: 'browser_status', arguments: {} });
  assert.equal(response.isError, undefined);
  assert.match(response.content[0].text, /connected/);
  assert.equal(stderr, '');
});
