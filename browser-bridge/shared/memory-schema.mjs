/**
 * Shared validation constants for the memory-mcp server.
 * Mirrors web/src/lib/memory.ts so the web API and the MCP server agree on
 * kinds, provenance, size limits, and FTS phrase escaping.
 */

export const MEMORY_KINDS = Object.freeze(['fact', 'preference', 'lesson', 'reference']);
export const MEMORY_PROVENANCES = Object.freeze([
  'agent',
  'auto-extract',
  'auto-extract-retrospective',
  'manual',
]);
export const MEMORY_CONTENT_MAX_CHARS = 2000;
export const MEMORY_SEARCH_LIMIT_DEFAULT = 5;
export const MEMORY_SEARCH_LIMIT_MAX = 50;

export function isMemoryKind(value) {
  return MEMORY_KINDS.includes(value);
}

export function isMemoryProvenance(value) {
  return MEMORY_PROVENANCES.includes(value);
}

export function memoryContentError(content) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return 'content must be a non-empty string';
  }
  if (content.length > MEMORY_CONTENT_MAX_CHARS) {
    return `content must be at most ${MEMORY_CONTENT_MAX_CHARS} characters`;
  }
  return null;
}

/** Escape a user query so FTS5 treats it as a single phrase. */
export function toFtsPhrase(query) {
  const sanitized = String(query).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (sanitized.length === 0) return '""';
  return `"${sanitized.replaceAll('"', '""')}"`;
}

const MEMORY_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;

function invalidInput() {
  const error = new Error('Invalid memory tool input');
  error.code = 'INVALID_REQUEST';
  throw error;
}

function assertObject(args, allowed) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) invalidInput();
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) invalidInput();
  }
}

function assertKind(value) {
  if (!isMemoryKind(value)) invalidInput();
}

function assertContent(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MEMORY_CONTENT_MAX_CHARS) {
    invalidInput();
  }
}

function assertQuery(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8192) invalidInput();
}

function assertId(value) {
  if (typeof value !== 'string' || !MEMORY_ID_RE.test(value)) invalidInput();
}

function assertLimit(value) {
  if (value === undefined) return MEMORY_SEARCH_LIMIT_DEFAULT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MEMORY_SEARCH_LIMIT_MAX) invalidInput();
  return value;
}

/**
 * Validate an MCP input and return a frozen normalized copy.
 * Throws an Error with `code = 'INVALID_REQUEST'` on malformed input.
 */
export const memoryValidate = Object.freeze({
  search(args) {
    assertObject(args, ['query', 'kind', 'limit']);
    assertQuery(args.query);
    if (args.kind !== undefined) assertKind(args.kind);
    return Object.freeze({ query: args.query, kind: args.kind, limit: assertLimit(args.limit) });
  },
  add(args) {
    assertObject(args, ['kind', 'content']);
    assertKind(args.kind);
    assertContent(args.content);
    return Object.freeze({ kind: args.kind, content: args.content });
  },
  update(args) {
    assertObject(args, ['id', 'content', 'kind']);
    assertId(args.id);
    if (args.content === undefined && args.kind === undefined) invalidInput();
    if (args.content !== undefined) assertContent(args.content);
    if (args.kind !== undefined) assertKind(args.kind);
    const next = { id: args.id };
    if (args.content !== undefined) next.content = args.content;
    if (args.kind !== undefined) next.kind = args.kind;
    return Object.freeze(next);
  },
  delete(args) {
    assertObject(args, ['id']);
    assertId(args.id);
    return Object.freeze({ id: args.id });
  },
});