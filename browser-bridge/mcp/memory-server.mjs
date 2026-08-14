import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { dataDir } from '../../scripts/lib/data-dir.mjs';
import {
  MEMORY_KINDS,
  inspectMemoryContent,
  isMemoryKind,
  memoryContentError,
  memorySimilarityVerdict,
  memoryValidate,
  normalizeMemoryKey,
  toFtsPhrase,
} from '../shared/memory-schema.mjs';

/** Rows compared when probing for a near-duplicate (mirrors the web limit). */
const DUPLICATE_SCAN_LIMIT = 3000;

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
  // Shared data-dir resolution (win32: %APPDATA%\leafcode, else
  // ~/.leafcode), aligned with scripts/lib/data-dir.mjs.
  return dataDir();
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
    scopeKind: row.scope_kind ?? null,
    scopeKey: row.scope_key ?? null,
  };
}

/**
 * Retrieval scope of a workspace (mirrors resolveMemoryScope in
 * web/src/lib/memory.ts): the project when known, else the workspace itself.
 * Resolved once at startup — the MCP process is pinned to one workspace.
 */
function resolveMemoryScope(db, workspaceId) {
  try {
    const row = db.prepare('SELECT project_id FROM workspaces WHERE id = ?').get(workspaceId);
    if (row && row.project_id) return { kind: 'project', key: row.project_id };
  } catch {
    // Pre-schema database: fall back to workspace scope.
  }
  return { kind: 'workspace', key: workspaceId };
}

function openMemoryDb(dbPathValue) {
  const db = new Database(dbPathValue, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  return db;
}

function readWriteApprovalSetting(db, fallback) {
  try {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('memory.write_approval');
    return row ? row.value === '1' : fallback;
  } catch {
    // Older/test databases may not have the settings table yet. Preserve the
    // launch-time fallback until WebUI initializes the shared schema.
    return fallback;
  }
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
  const hasMemoryColumn = (name) => memoryColumns.some((column) => column.name === name);
  if (!hasMemoryColumn('revision')) {
    db.exec('ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  }
  // Scope/dedupe columns. The web side owns the backfill; here they only need to
  // exist so MCP writes are visible to project-scoped retrieval.
  if (!hasMemoryColumn('scope_kind')) db.exec('ALTER TABLE memories ADD COLUMN scope_kind TEXT');
  if (!hasMemoryColumn('scope_key')) db.exec('ALTER TABLE memories ADD COLUMN scope_key TEXT');
  if (!hasMemoryColumn('norm_key')) db.exec('ALTER TABLE memories ADD COLUMN norm_key TEXT');

  const scope = resolveMemoryScope(db, workspaceId);
  // Reads and mutations match on the scope, so an agent running in a new task
  // sees (and can correct) knowledge captured by earlier tasks of the project.
  const selectById = db.prepare(
    'SELECT * FROM memories WHERE id = ? AND (scope_key = ? OR workspace_id = ?)',
  );
  const insert = db.prepare(`
    INSERT INTO memories
      (id, workspace_id, kind, content, source_session_id, provenance, approved,
       created_at, updated_at, last_used_at, use_count, scope_kind, scope_key, norm_key)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
  `);
  const update = db.prepare(
    'UPDATE memories SET content = COALESCE(?, content), norm_key = COALESCE(?, norm_key), kind = COALESCE(?, kind), approved = CASE WHEN ? = 1 THEN 0 ELSE approved END, updated_at = ?, revision = revision + 1 WHERE id = ? AND (scope_key = ? OR workspace_id = ?) AND revision = ?',
  );
  const remove = db.prepare(
    'DELETE FROM memories WHERE id = ? AND (scope_key = ? OR workspace_id = ?) AND revision = ?',
  );
  const selectByNormKey = db.prepare(
    `SELECT * FROM memories
     WHERE (scope_key = ? OR workspace_id = ?) AND norm_key = ?
     ORDER BY approved DESC, use_count DESC, id DESC
     LIMIT 1`,
  );
  const selectDuplicateCandidates = db.prepare(
    `SELECT * FROM memories
     WHERE (scope_key = ? OR workspace_id = ?)
     ORDER BY approved DESC, updated_at DESC
     LIMIT ?`,
  );
  const touch = db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?');
  const audit = db.prepare(`
    INSERT INTO memory_audit_log
      (action, workspace_id, memory_id, session_id, detail, created_at)
    VALUES (?, ?, ?, NULL, ?, ?)
  `);

  /** Existing row stating the same thing, or undefined when content is new. */
  function findDuplicate(content) {
    const normKey = normalizeMemoryKey(content);
    if (normKey.length > 0) {
      const exact = selectByNormKey.get(scope.key, workspaceId, normKey);
      if (exact) return exact;
    }
    const candidates = selectDuplicateCandidates.all(scope.key, workspaceId, DUPLICATE_SCAN_LIMIT);
    for (const candidate of candidates) {
      if (memorySimilarityVerdict(candidate.content, content).duplicate) return candidate;
    }
    return undefined;
  }

  return {
    workspaceId,
    scope,
    search({ query, kind, limit }) {
      const phrase = toFtsPhrase(query);
      const clauses = ['memories_fts MATCH ?', '(m.scope_key = ? OR m.workspace_id = ?)'];
      const params = [phrase, scope.key, workspaceId];
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
        audit.run('reject', workspaceId, null, `threat=${violation.code}`, Date.now());
        const error = new Error(violation.message);
        error.code = 'INVALID_REQUEST';
        throw error;
      }
      const trimmed = content.trim();
      // Re-adding a known fact returns the existing row instead of storing a
      // second wording of it. Agents re-state conventions constantly, and every
      // stored paraphrase consumes part of the injection budget forever.
      const duplicate = findDuplicate(trimmed);
      if (duplicate) {
        const nowTouch = Date.now();
        touch.run(nowTouch, duplicate.id);
        audit.run('create', workspaceId, duplicate.id, 'provenance=agent duplicate=1', nowTouch);
        return { ...toMemoryDto(duplicate), duplicate: true };
      }
      const id = randomUUID();
      const now = Date.now();
      const approved = readWriteApprovalSetting(db, writeApproval) ? 0 : 1;
      insert.run(
        id,
        workspaceId,
        kind,
        trimmed,
        'agent',
        approved,
        now,
        now,
        scope.kind,
        scope.key,
        normalizeMemoryKey(trimmed),
      );
      audit.run('create', workspaceId, id, `provenance=agent approved=${approved}`, now);
      return toMemoryDto(selectById.get(id, scope.key, workspaceId));
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
          audit.run('reject', workspaceId, id, `threat=${violation.code}`, Date.now());
          const error = new Error(violation.message);
          error.code = 'INVALID_REQUEST';
          throw error;
        }
      }
      const now = Date.now();
      const writeApprovalNow = readWriteApprovalSetting(db, writeApproval) ? 1 : 0;
      const nextContent = content !== undefined ? content.trim() : null;
      const changed = update.run(
        nextContent,
        nextContent !== null ? normalizeMemoryKey(nextContent) : null,
        kind !== undefined ? kind : null,
        writeApprovalNow,
        now,
        id,
        scope.key,
        workspaceId,
        expectedRevision,
      );
      if (changed.changes === 0) {
        const conflict = Boolean(selectById.get(id, scope.key, workspaceId));
        const error = new Error(conflict ? 'memory revision conflict' : 'memory not found');
        error.code = conflict ? 'CONFLICT' : 'NOT_FOUND';
        throw error;
      }
      audit.run('update', workspaceId, id, null, now);
      return toMemoryDto(selectById.get(id, scope.key, workspaceId));
    },
    delete({ id, expectedRevision }) {
      const changed = remove.run(id, scope.key, workspaceId, expectedRevision);
      if (changed.changes === 0) {
        const conflict = Boolean(selectById.get(id, scope.key, workspaceId));
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
      'Search the project memory store (approved memories only) via FTS5. Covers memories captured by earlier tasks in the same project. Bumps usage so frequently-used memories are injected first.',
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
      'Store a durable, reusable fact/preference/lesson/reference for this project. Written rows are approved and appear in future injection context. content must be a proposition, not code or file contents. Re-adding something already stored (even reworded) returns the existing row with duplicate=true instead of creating a second entry.',
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
