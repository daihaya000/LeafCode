import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MEMORY_KINDS,
  inspectMemoryContent,
  isMemoryKind,
  memoryContentError,
  memoryValidate,
  toFtsPhrase,
} from '../shared/memory-schema.mjs';

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
});
const DESTRUCTIVE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});

function dbPath(dataDir) {
  return path.join(dataDir, 'webui.db');
}

function resolveDataDir(env) {
  if (typeof env.OPENCODE_WEBUI_DATA_DIR === 'string' && env.OPENCODE_WEBUI_DATA_DIR.trim() !== '') {
    return path.resolve(env.OPENCODE_WEBUI_DATA_DIR);
  }
  // Mirror web/src/lib/paths.ts when the absolute path was not injected.
  if (process.platform === 'win32') {
    const base = env.APPDATA ?? path.join((env.HOME || env.USERPROFILE || ''), 'AppData', 'Roaming');
    return path.join(base, 'opencode-webui');
  }
  return path.join(env.HOME || env.HOME_PATH || '', '.local', 'share', 'opencode-webui');
}

export function resolveWorkspace({ argv, env }) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--workspace' && argv[i + 1] !== undefined) return argv[i + 1];
    if (argv[i].startsWith('--workspace=')) return argv[i].slice('--workspace='.length);
  }
  return env.OPENCODE_WEBUI_MEMORY_WORKSPACE ?? null;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(code, message) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }] };
}

function toMemoryDto(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    content: row.content,
    sourceSessionId: row.source_session_id,
    provenance: row.provenance,
    approved: row.approved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}

function openMemoryDb(dbPathValue) {
  const db = new Database(dbPathValue, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  return db;
}

function createMemoryStore(db, workspaceId, { writeApproval = false } = {}) {
  if (!workspaceId) {
    throw new Error('memory-mcp requires a workspace (--workspace=<id> or OPENCODE_WEBUI_MEMORY_WORKSPACE)');
  }

  // Keep MCP writes auditable even when it starts before the WebUI has opened
  // an existing database and applied its schema initialization.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_audit_log (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      workspace_id TEXT,
      memory_id TEXT,
      session_id TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const memoryColumns = db.pragma('table_info(memories)');
  if (!memoryColumns.some((column) => column.name === 'revision')) {
    db.exec('ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  }

  const selectById = db.prepare('SELECT * FROM memories WHERE id = ? AND workspace_id = ?');
  const insert = db.prepare(`
    INSERT INTO memories
      (id, workspace_id, kind, content, source_session_id, provenance, approved,
       created_at, updated_at, last_used_at, use_count)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, 0)
  `);
  const update = db.prepare('UPDATE memories SET content = COALESCE(?, content), kind = COALESCE(?, kind), updated_at = ?, revision = revision + 1 WHERE id = ? AND workspace_id = ? AND revision = ?');
  const remove = db.prepare('DELETE FROM memories WHERE id = ? AND workspace_id = ? AND revision = ?');
  const audit = db.prepare(`
    INSERT INTO memory_audit_log
      (action, workspace_id, memory_id, session_id, detail, created_at)
    VALUES (?, ?, ?, NULL, ?, ?)
  `);

  return {
    workspaceId,
    search({ query, kind, limit }) {
      const phrase = toFtsPhrase(query);
      const clauses = ['memories_fts MATCH ?', 'm.workspace_id = ?'];
      const params = [phrase, workspaceId];
      if (kind && isMemoryKind(kind)) {
        clauses.push('m.kind = ?');
        params.push(kind);
      }
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT m.* FROM memories_fts f
           JOIN memories m ON m.id = f.id
           WHERE ${clauses.join(' AND ')} AND m.approved = 1
           ORDER BY f.rank
           LIMIT ?`,
        )
        .all(...params);
      if (rows.length > 0) {
        const now = Date.now();
        const bump = db.prepare('UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?');
        const tx = db.transaction(() => {
          for (const row of rows) bump.run(now, row.id);
        });
        tx();
      }
      return rows.map(toMemoryDto);
    },
    add({ kind, content }) {
      const contentError = memoryContentError(content);
      if (contentError) {
        const error = new Error(contentError);
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const violation = inspectMemoryContent(content);
      if (violation) {
        const error = new Error(violation.message);
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const id = randomUUID();
      const now = Date.now();
      const approved = writeApproval ? 0 : 1;
      insert.run(id, workspaceId, kind, content.trim(), 'agent', approved, now, now);
      audit.run('create', workspaceId, id, `provenance=agent approved=${approved}`, now);
      return toMemoryDto(selectById.get(id, workspaceId));
    },
    update({ id, content, kind, expectedRevision }) {
      if (content !== undefined && memoryContentError(content)) {
        const error = new Error(memoryContentError(content));
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      if (content !== undefined) {
        const violation = inspectMemoryContent(content);
        if (violation) {
          const error = new Error(violation.message);
          error.code = 'INVALID_REQUEST';
          throw error;
        }
      }
      const now = Date.now();
      const changed = update.run(
        content !== undefined ? content.trim() : null,
        kind !== undefined ? kind : null,
        now,
        id,
        workspaceId,
        expectedRevision,
      );
      if (changed.changes === 0) {
        const conflict = Boolean(selectById.get(id, workspaceId));
        const error = new Error(conflict ? 'memory revision conflict' : 'memory not found');
        error.code = conflict ? 'CONFLICT' : 'NOT_FOUND';
        throw error;
      }
      audit.run('update', workspaceId, id, null, now);
      return toMemoryDto(selectById.get(id, workspaceId));
    },
    delete({ id, expectedRevision }) {
      const changed = remove.run(id, workspaceId, expectedRevision);
      if (changed.changes === 0) {
        const conflict = Boolean(selectById.get(id, workspaceId));
        const error = new Error(conflict ? 'memory revision conflict' : 'memory not found');
        error.code = conflict ? 'CONFLICT' : 'NOT_FOUND';
        throw error;
      }
      audit.run('delete', workspaceId, id, null, Date.now());
      return { ok: true };
    },
  };
}

const kindSchema = z.enum(MEMORY_KINDS);

function buildTools(server, store) {
  server.registerTool('memory_search', {
    title: 'memory_search',
    description:
      'Search the workspace memory store (approved memories only) via FTS5. Bumps usage so frequently-used memories are injected first.',
    inputSchema: z.object({
      query: z.string().min(1).max(8192),
      kind: kindSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async (args) => textResult(store.search(memoryValidate.search(args))));

  server.registerTool('memory_add', {
    title: 'memory_add',
    description:
      "a durable, reusable fact/preference/lesson/reference for this workspace. Written rows are approved and appear in future injection context. content must be a proposition, not code or file contents.",
    inputSchema: z.object({
      kind: kindSchema,
      content: z.string().min(1).max(2000),
    }).strict(),
    annotations: WRITE_ANNOTATIONS,
  }, async (args) => textResult(store.add(memoryValidate.add(args))));

  server.registerTool('memory_update', {
    title: 'memory_update',
    description: 'Overwrite content and/or kind of an existing memory by id. Errors when the id does not exist.',
    inputSchema: z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
      expectedRevision: z.number().int().min(0),
      content: z.string().min(1).max(2000).optional(),
      kind: kindSchema.optional(),
    }).strict(),
    annotations: WRITE_ANNOTATIONS,
  }, async (args) => textResult(store.update(memoryValidate.update(args))));

  server.registerTool('memory_delete', {
    title: 'memory_delete',
    description: 'Permanently delete a memory by id. Errors when the id does not exist.',
    inputSchema: z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
      expectedRevision: z.number().int().min(0),
    }).strict(),
    annotations: DESTRUCTIVE_ANNOTATIONS,
  }, async (args) => textResult(store.delete(memoryValidate.delete(args))));
}

export function createMemoryMcpServer({ dbPath: dbPathValue, workspaceId, writeApproval = false }) {
  const db = openMemoryDb(dbPathValue);
  const store = createMemoryStore(db, workspaceId, { writeApproval });
  const server = new McpServer({ name: 'opencode-webui-memory', version: '0.1.0' });
  buildTools(server, store);
  return { server, db };
}

export async function runStdio({ env = process.env, argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout } = {}) {
  const dataDir = resolveDataDir(env);
  const workspaceId = resolveWorkspace({ argv, env });
  const writeApproval = env.OPENCODE_WEBUI_MEMORY_WRITE_APPROVAL === '1';
  const { server, db } = createMemoryMcpServer({ dbPath: dbPath(dataDir), workspaceId, writeApproval });
  const transport = new StdioServerTransport(stdin, stdout, { maxBufferSize: 1024 * 1024 });
  await server.connect(transport);
  return { server, db };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  runStdio().catch((error) => {
    process.stderr.write(`Memory MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
