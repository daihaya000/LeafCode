/**
 * Session-crossing persistent memory (docs/specs/memory-layer.md).
 *
 * Pure DB operations over the `memories` table and its FTS5 access path, plus
 * the injection block builder and audit logging. No network / OpenCode calls
 * live here: everything is synchronous against `better-sqlite3`.
 */

import { getDb } from "./db";

export const MEMORY_KINDS = ["fact", "preference", "lesson", "reference"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_PROVENANCES = [
  "agent",
  "auto-extract",
  "auto-extract-retrospective",
  "manual",
] as const;
export type MemoryProvenance = (typeof MEMORY_PROVENANCES)[number];

export const MEMORY_CONTENT_MAX_CHARS = 2000;
export const MEMORY_INJECTION_MAX_ITEMS = 8;

export type MemoryRow = {
  id: string;
  workspace_id: string;
  kind: MemoryKind;
  content: string;
  source_session_id: string | null;
  provenance: MemoryProvenance;
  approved: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
};

/** Public DTO (camelCase) surfaced by the web API / UI. */
export type MemoryDto = {
  id: string;
  workspaceId: string;
  kind: MemoryKind;
  content: string;
  sourceSessionId: string | null;
  provenance: MemoryProvenance;
  approved: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
};

export function isMemoryKind(value: unknown): value is MemoryKind {
  return MEMORY_KINDS.includes(value as MemoryKind);
}

export function isMemoryProvenance(value: unknown): value is MemoryProvenance {
  return MEMORY_PROVENANCES.includes(value as MemoryProvenance);
}

/** Length check shared by the MCP server consumer and the web API. */
export function memoryContentError(content: unknown): string | null {
  if (typeof content !== "string" || content.trim().length === 0) {
    return "content must be a non-empty string";
  }
  if (content.length > MEMORY_CONTENT_MAX_CHARS) {
    return `content must be at most ${MEMORY_CONTENT_MAX_CHARS} characters`;
  }
  return null;
}

export function toMemoryDto(row: MemoryRow): MemoryDto {
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

/**
 * Insert a single memory. `approved` is 1 only for `agent` provenance (MCP
 * `memory_add`) and for retrospective-acked rows; auto-extract rows must pass
 * `approved: false` so they surface as candidates.
 * Throws `RangeError` on invalid kind / content.
 */
export function createMemory(input: {
  workspaceId: string;
  kind: MemoryKind;
  content: string;
  sourceSessionId?: string;
  provenance: MemoryProvenance;
  approved?: boolean;
}): MemoryDto {
  if (!isMemoryKind(input.kind)) throw new RangeError("invalid memory kind");
  const contentError = memoryContentError(input.content);
  if (contentError) throw new RangeError(contentError);
  const now = Date.now();
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO memories
        (id, workspace_id, kind, content, source_session_id, provenance, approved,
         created_at, updated_at, last_used_at, use_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    )
    .run(
      id,
      input.workspaceId,
      input.kind,
      input.content.trim(),
      input.sourceSessionId ?? null,
      input.provenance,
      input.approved ? 1 : 0,
      now,
      now,
    );
  return getMemoryById(id) as MemoryDto;
}

export function getMemoryById(id: string): MemoryDto | undefined {
  const row = getDb()
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as MemoryRow | undefined;
  return row ? toMemoryDto(row) : undefined;
}

export function listMemories(filter?: {
  workspaceId?: string;
  approved?: boolean;
  kind?: MemoryKind;
}): MemoryDto[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter?.approved !== undefined) {
    clauses.push("approved = ?");
    params.push(filter.approved ? 1 : 0);
  }
  if (filter?.kind && isMemoryKind(filter.kind)) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories${where} ORDER BY updated_at DESC, id DESC`,
    )
    .all(...params) as MemoryRow[];
  return rows.map(toMemoryDto);
}

export function approveMemory(id: string): MemoryDto | undefined {
  const now = Date.now();
  const result = getDb()
    .prepare(
      `UPDATE memories SET approved = 1, updated_at = ? WHERE id = ?`,
    )
    .run(now, id);
  return result.changes > 0 ? getMemoryById(id) : undefined;
}

export function updateMemory(
  id: string,
  patch: { content?: string; kind?: MemoryKind },
): MemoryDto | undefined {
  if (patch.kind !== undefined && !isMemoryKind(patch.kind)) {
    throw new RangeError("invalid memory kind");
  }
  if (patch.content !== undefined) {
    const contentError = memoryContentError(patch.content);
    if (contentError) throw new RangeError(contentError);
  }
  const assignments: string[] = [];
  const params: unknown[] = [];
  if (patch.kind !== undefined) {
    assignments.push("kind = ?");
    params.push(patch.kind);
  }
  if (patch.content !== undefined) {
    assignments.push("content = ?");
    params.push(patch.content.trim());
  }
  if (assignments.length === 0) return getMemoryById(id);
  assignments.push("updated_at = ?");
  params.push(Date.now());
  params.push(id);
  const result = getDb()
    .prepare(`UPDATE memories SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...params);
  return result.changes > 0 ? getMemoryById(id) : undefined;
}

export function deleteMemory(id: string): boolean {
  return getDb().prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}

/** Count approved rows for a workspace (used by the injection cap). */
export function countApprovedMemories(workspaceId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM memories WHERE workspace_id = ? AND approved = 1")
    .get(workspaceId) as { n: number };
  return row.n;
}

/** Exact-match duplicate probe used by both auto-extract and retrospective. */
export function findExactDuplicateMemory(
  workspaceId: string,
  content: string,
): MemoryDto | undefined {
  const row = getDb()
    .prepare(
      "SELECT * FROM memories WHERE workspace_id = ? AND content = ? ORDER BY id DESC LIMIT 1",
    )
    .get(workspaceId, content.trim()) as MemoryRow | undefined;
  return row ? toMemoryDto(row) : undefined;
}

/** Escape a user query so FTS5 treats it as a single phrase. */
export function toFtsPhrase(query: string): string {
  // Inside a double-quoted FTS5 phrase, an embedded double quote is escaped by
  // doubling it. Control chars are stripped so no tokenizer surprises sneak in.
  const sanitized = query.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (sanitized.length === 0) return '""';
  return `"${sanitized.replaceAll('"', '""')}"`;
}

/**
 * Full-text search over approved rows. On hit it bumps `last_used_at` /
 * `use_count` so the most-used approved memories float to the top of the
 * injection block.
 */
export function searchMemories(input: {
  workspaceId?: string;
  query: string;
  kind?: MemoryKind;
  limit?: number;
}): MemoryDto[] {
  const phrase = toFtsPhrase(input.query);
  const limit = Math.max(1, Math.min(50, input.limit ?? 5));
  const params: unknown[] = [phrase];
  const clauses = ["memories_fts MATCH ?"];
  if (input.workspaceId) {
    clauses.push("m.workspace_id = ?");
    params.push(input.workspaceId);
  }
  if (input.kind && isMemoryKind(input.kind)) {
    clauses.push("m.kind = ?");
    params.push(input.kind);
  }
  params.push(limit);
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM memories_fts f
       JOIN memories m ON m.id = f.id
       WHERE ${clauses.join(" AND ")} AND m.approved = 1
       ORDER BY f.rank
       LIMIT ?`,
    )
    .all(...params) as MemoryRow[];
  if (rows.length > 0) {
    const now = Date.now();
    const bump = getDb().prepare(
      "UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?",
    );
    const tx = getDb().transaction(() => {
      for (const row of rows) bump.run(now, row.id);
    });
    tx();
  }
  return rows.map(toMemoryDto);
}

/**
 * Best-8 injection block, most-used first, approved only. Returns "" when the
 * workspace has nothing to inject. Used as a prefix on the first user message.
 */
export function buildMemoryInjectionBlock(
  memories: Array<{ kind: MemoryKind; content: string }>,
): string {
  if (memories.length === 0) return "";
  const lines = memories
    .slice(0, MEMORY_INJECTION_MAX_ITEMS)
    .map((m) => `- [${m.kind}] ${m.content}`);
  return `<workspace-memory>\n${lines.join("\n")}\n</workspace-memory>`;
}

/**
 * Strips a leading `<workspace-memory>…</workspace-memory>` block from user
 * text at render time. The block is internal context injected into the first
 * goal-loop message and must not be shown to the user. Returns "" when the
 * whole text was just the block.
 */
export function stripMemoryInjectionBlock(text: string): string {
  const match = text.match(/^\s*<workspace-memory>[\s\S]*?<\/workspace-memory>/);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\s*\n/, "");
}

/**
 * Returns the best-8 injection block for a workspace and bumps each injected
 * row's `use_count` (the spec's "injected lines +1"); a purely advisory lookup
 * should use {@link buildMemoryInjectionBlock} directly. Returns "" when there
 * is nothing to inject.
 */
export function memoryInjectionFor(workspaceId: string): string {
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories
       WHERE workspace_id = ? AND approved = 1
       ORDER BY use_count DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(workspaceId, MEMORY_INJECTION_MAX_ITEMS) as MemoryRow[];
  if (rows.length > 0) {
    const now = Date.now();
    const bump = getDb().prepare(
      "UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?",
    );
    const tx = getDb().transaction(() => {
      for (const row of rows) bump.run(now, row.id);
    });
    tx();
  }
  return buildMemoryInjectionBlock(rows);
}

/**
 * Insert an extraction/retrospective result. Each item is validated and
 * deduplicated by exact content match; the whole batch skips duplicates.
 * Returns per-run accounting for callers (API / driver) to report.
 */
export function insertExtractedMemories(input: {
  workspaceId: string;
  sourceSessionId?: string;
  provenance: MemoryProvenance;
  approved?: boolean;
  items: Array<{ kind: MemoryKind; content: string }>;
}): { created: number; skipped: number; errors: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const tx = getDb().transaction(() => {
    for (const item of input.items) {
      if (!isMemoryKind(item.kind)) {
        errors.push(`invalid kind: ${String(item.kind)}`);
        continue;
      }
      const contentError = memoryContentError(item.content);
      if (contentError) {
        errors.push(contentError);
        continue;
      }
      if (findExactDuplicateMemory(input.workspaceId, item.content)) {
        skipped.push(item.content);
        continue;
      }
      created.push(
        createMemory({
          workspaceId: input.workspaceId,
          kind: item.kind,
          content: item.content,
          sourceSessionId: input.sourceSessionId,
          provenance: input.provenance,
          approved: input.approved,
        }).id,
      );
    }
  });
  tx();
  return { created: created.length, skipped: skipped.length, errors };
}

export type MemoryAuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "extract";

/** Single-line JSON audit to stdout, captured by the host tee (mirrors pty-audit). */
export function logMemoryAudit(
  action: MemoryAuditAction,
  fields: {
    workspaceId?: string;
    memoryId?: string;
    sessionId?: string;
    detail?: string;
  },
): void {
  const entry: Record<string, unknown> = { action };
  if (fields.workspaceId) entry.workspaceId = fields.workspaceId;
  if (fields.memoryId) entry.memoryId = fields.memoryId;
  if (fields.sessionId) entry.sessionId = fields.sessionId;
  if (fields.detail) entry.detail = fields.detail;
  console.log(`memory-audit ${JSON.stringify(entry)}`);
}