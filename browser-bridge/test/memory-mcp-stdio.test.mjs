import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverScript = fileURLToPath(new URL('../mcp/memory-server.mjs', import.meta.url));

function createMemorySchema(db) {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session_id TEXT,
      provenance TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_memories_ws ON memories(workspace_id, approved);
    CREATE TABLE memory_audit_log (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      workspace_id TEXT,
      memory_id TEXT,
      session_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, content);
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts SET content = new.content WHERE id = new.id;
    END;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE id = old.id;
    END;
  `);
}

function mkLaunch(dataDir) {
  return {
    command: process.execPath,
    args: [serverScript, '--workspace', 'ws-1'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCODE_WEBUI_DATA_DIR: dataDir,
      OPENCODE_WEBUI_MEMORY_WORKSPACE: 'ignored-arg-wins',
    },
    stderr: 'pipe',
  };
}

async function connectClient(transport) {
  const client = new Client({ name: 'memory-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('memory MCP: add, search (FTS + bump), update, delete flows', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-webui-memory-mcp-'));
  const db = new Database(path.join(dir, 'webui.db'));
  createMemorySchema(db);
  db.pragma('journal_mode = WAL');
  db.close();

  const transport = new StdioClientTransport(mkLaunch(dir));
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = await connectClient(transport);
  t.after(() => client.close());
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ['memory_add', 'memory_delete', 'memory_search', 'memory_update'],
  );
  const migrated = new Database(path.join(dir, 'webui.db'));
  assert.ok(
    migrated.pragma('table_info(memories)').some((column) => column.name === 'revision'),
  );
  migrated.close();

  // Add two approved memories.
  const added = await client.callTool({
    name: 'memory_add',
    arguments: { kind: 'fact', content: 'The Dockerfile uses multi-stage builds' },
  });
  assert.equal(added.isError, undefined);
  const addedJson = JSON.parse(added.content[0].text);
  assert.equal(addedJson.approved, true);
  assert.equal(addedJson.provenance, 'agent');
  assert.equal(addedJson.kind, 'fact');

  const added2 = await client.callTool({
    name: 'memory_add',
    arguments: { kind: 'lesson', content: 'Never commit secrets to .env.example' }
  });
  assert.equal(added2.isError, undefined);
  const secondId = JSON.parse(added2.content[0].text).id;

  // Unapproved rows must NOT be searchable (create one directly).
  const admin = new Database(path.join(dir, 'webui.db'));
  admin.prepare(
    `INSERT INTO memories (id, workspace_id, kind, content, provenance, approved, created_at, updated_at, use_count)
     VALUES ('cand-1', 'ws-1', 'fact', 'docker uses buildkit', 'auto-extract', 0, 1, 1, 0)`
  ).run();
  admin.close();

  const searched = await client.callTool({
    name: 'memory_search',
    arguments: { query: 'builds', kind: 'fact' }
  });
  const hits = JSON.parse(searched.content[0].text);
  assert.equal(searched.isError, undefined);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].content, 'The Dockerfile uses multi-stage builds');
  // Search returns a pre-bump snapshot; the hit was already bumped to 1.
  assert.equal(hits[0].useCount, 0);

  // A second search on the same row bumps use_count again (snapshot shows 1).
  const again = await client.callTool({
    name: 'memory_search',
    arguments: { query: 'Dockerfile', limit: 5 },
  });
  const bumpHits = JSON.parse(again.content[0].text);
  assert.equal(bumpHits.length, 1);
  assert.equal(bumpHits[0].useCount, 1);

  // Update content/kind and verify.
  const updated = await client.callTool({
    name: 'memory_update',
    arguments: { id: secondId, expectedRevision: 0, kind: 'preference', content: 'Prefer .env for secrets' },
  });
  assert.equal(updated.isError, undefined);
  const updatedJson = JSON.parse(updated.content[0].text);
  assert.equal(updatedJson.kind, 'preference');

  const stale = await client.callTool({
    name: 'memory_update',
    arguments: { id: secondId, expectedRevision: 0, content: 'stale write' },
  });
  assert.equal(stale.isError, true);

  // Delete and confirm gone.
  const deleted = await client.callTool({
    name: 'memory_delete',
    arguments: { id: secondId, expectedRevision: 1 },
  });
  assert.equal(deleted.isError, undefined);
  const delHits = JSON.parse((await client.callTool({
    name: 'memory_search',
    arguments: { query: 'secrets', limit: 10 },
  })).content[0].text);
  assert.equal(delHits.length, 0);

  assert.equal(stderr, '');
});

test('memory MCP: validation and not-found errors', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-webui-memory-mcp-'));
  const db = new Database(path.join(dir, 'webui.db'));
  createMemorySchema(db);
  db.pragma('journal_mode = WAL');
  db.close();

  const transport = new StdioClientTransport(mkLaunch(dir));
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = await connectClient(transport);
  t.after(() => client.close());
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });

  const badKind = await client.callTool({
    name: 'memory_add',
    arguments: { kind: 'rumor', content: 'nope' },
  });
  assert.equal(badKind.isError, true);

  const missing = await client.callTool({
    name: 'memory_update',
    arguments: { id: 'no-such-id', expectedRevision: 0, content: 'x' },
  });
  assert.equal(missing.isError, true);

  const tooLong = await client.callTool({
    name: 'memory_add',
    arguments: { kind: 'fact', content: 'x'.repeat(3000) },
  });
  assert.equal(tooLong.isError, true);

  assert.equal(stderr, '');
});

test('memory MCP: cannot modify a memory in another workspace', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-webui-memory-mcp-'));
  const db = new Database(path.join(dir, 'webui.db'));
  createMemorySchema(db);
  db.prepare(
    `INSERT INTO memories (id, workspace_id, kind, content, provenance, approved, created_at, updated_at, use_count)
     VALUES ('other-memory', 'ws-2', 'fact', 'private', 'manual', 1, 1, 1, 0)`,
  ).run();
  db.close();

  const transport = new StdioClientTransport(mkLaunch(dir));
  const client = await connectClient(transport);
  t.after(() => client.close());
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });

  const updated = await client.callTool({
    name: 'memory_update',
    arguments: { id: 'other-memory', expectedRevision: 0, content: 'changed' },
  });
  assert.equal(updated.isError, true);
  const deleted = await client.callTool({
    name: 'memory_delete',
    arguments: { id: 'other-memory', expectedRevision: 0 },
  });
  assert.equal(deleted.isError, true);
});

test('memory MCP requires a workspace; CLI --workspace wins over env', async () => {
  const { resolveWorkspace } = await import('../mcp/memory-server.mjs');
  assert.equal(
    resolveWorkspace({ argv: ['--workspace=ws-9'], env: { OPENCODE_WEBUI_MEMORY_WORKSPACE: 'env-ws' } }),
    'ws-9',
  );
  assert.equal(
    resolveWorkspace({ argv: [], env: { OPENCODE_WEBUI_MEMORY_WORKSPACE: 'env-ws' } }),
    'env-ws',
  );
  assert.equal(resolveWorkspace({ argv: [], env: {} }), null);
});
