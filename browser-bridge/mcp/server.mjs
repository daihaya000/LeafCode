import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BrowserBridgeErrorCode } from '../shared/errors.mjs';
import { normalizeWebuiEnv } from '../../scripts/lib/env-compat.mjs';
import { BrowserToolName, validateToolInput } from '../shared/schemas.mjs';
import { BrowserBridgeClient } from './broker-client.mjs';

const TAB_ID_SCHEMA = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const ACTION_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolResult(name, value) {
  const image = value?.image;
  if (name === BrowserToolName.SCREENSHOT && typeof image?.data === 'string' && ['image/png', 'image/jpeg'].includes(image.mimeType)) {
    return { content: [{ type: 'image', data: image.data, mimeType: image.mimeType }] };
  }
  return textResult(value);
}

function errorResult(code) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code } }) }] };
}

function registerReadTool(server, brokerClient, name, description, inputSchema) {
  registerTool(server, brokerClient, name, description, inputSchema, READ_ONLY_ANNOTATIONS);
}

function registerTool(server, brokerClient, name, description, inputSchema, annotations) {
  server.registerTool(name, {
    title: name,
    description,
    inputSchema,
    annotations,
  }, async (args) => {
    try {
      const input = validateToolInput(name, args);
      return toolResult(name, await brokerClient.call(name, input));
    } catch (error) {
      const code = error?.code;
      return errorResult(Object.values(BrowserBridgeErrorCode).includes(code)
        ? code
        : BrowserBridgeErrorCode.BROKER_UNAVAILABLE);
    }
  });
}

export function createMcpServer({ brokerClient }) {
  if (!brokerClient || typeof brokerClient.call !== 'function') {
    throw new TypeError('Broker client is required');
  }
  const server = new McpServer({ name: 'opencode-webui-browser-bridge', version: '0.1.0' });
  registerReadTool(server, brokerClient, BrowserToolName.STATUS, 'Get Browser Bridge connection status.', z.object({}).strict());
  registerReadTool(server, brokerClient, BrowserToolName.LIST_TABS, 'List explicitly shared browser tabs.', z.object({}).strict());
  registerReadTool(server, brokerClient, BrowserToolName.SNAPSHOT, 'Read a privacy-filtered accessibility snapshot of a shared tab.', z.object({ tabId: TAB_ID_SCHEMA }).strict());
  registerTool(server, brokerClient, BrowserToolName.SCREENSHOT, 'Request an approved screenshot of a shared tab.', z.object({ tabId: TAB_ID_SCHEMA }).strict(), ACTION_ANNOTATIONS);
  registerTool(server, brokerClient, BrowserToolName.TYPE, 'Type text into an approved shared-tab input ref.', z.object({
    tabId: TAB_ID_SCHEMA,
    ref: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    snapshotGeneration: z.number().int().positive(),
    text: z.string().min(1).max(8000),
    append: z.boolean().optional(),
  }).strict(), ACTION_ANNOTATIONS);
  registerTool(server, brokerClient, BrowserToolName.SCROLL, 'Scroll an approved shared tab by a bounded amount.', z.object({
    tabId: TAB_ID_SCHEMA,
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(2000),
  }).strict(), ACTION_ANNOTATIONS);
  registerTool(server, brokerClient, BrowserToolName.NAVIGATE, 'Navigate an approved shared tab to an allowed URL.', z.object({
    tabId: TAB_ID_SCHEMA,
    url: z.string().url().max(8192),
  }).strict(), ACTION_ANNOTATIONS);
  return server;
}

export async function runStdio({ env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  normalizeWebuiEnv(env);
  const server = createMcpServer({ brokerClient: BrowserBridgeClient.fromEnvironment(env) });
  const transport = new StdioServerTransport(stdin, stdout, { maxBufferSize: 1024 * 1024 });
  await server.connect(transport);
  return server;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  runStdio().catch((error) => {
    process.stderr.write(`Browser Bridge MCP failed to start: ${error?.code ?? 'BROKER_UNAVAILABLE'}\n`);
    process.exitCode = 1;
  });
}
