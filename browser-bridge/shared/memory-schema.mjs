/**
 * Shared validation constants for the memory-mcp server.
 * Mirrors web/src/lib/memory.ts so the web API and the MCP server agree on
 * kinds, provenance, size limits, and FTS phrase escaping.
 */

import {
  jaccard,
  lengthCompatible,
  memoryIdentifiers,
  memoryPolarity,
  memorySimilarityVerdict,
  memoryTrigrams,
  normalizeMemoryKey,
  MEMORY_IDENTIFIER_OVERLAP,
  MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS,
  MEMORY_SIMILARITY_NO_IDENTIFIERS,
  MEMORY_SIMILARITY_SAME_IDENTIFIERS,
  MEMORY_TRIGRAM_SIZE,
} from '../../scripts/lib/memory-key.mjs';
export {
  jaccard,
  memoryIdentifiers,
  memoryPolarity,
  memorySimilarityVerdict,
  memoryTrigrams,
  normalizeMemoryKey,
  MEMORY_IDENTIFIER_OVERLAP,
  MEMORY_SIMILARITY_DIFFERENT_IDENTIFIERS,
  MEMORY_SIMILARITY_NO_IDENTIFIERS,
  MEMORY_SIMILARITY_SAME_IDENTIFIERS,
  MEMORY_TRIGRAM_SIZE,
};

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

const INVISIBLE_UNICODE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/;
const MEMORY_BOUNDARY_TAG_RE = /<\/?workspace-memory>/i;

const PROMPT_INJECTION_PATTERNS = Object.freeze([
  { re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i, label: 'ignore previous instructions' },
  { re: /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i, label: 'disregard previous instructions' },
  { re: /you\s+are\s+(?:now|actually)\s+(?:a|an)\s+/i, label: 'identity override' },
  { re: /(?:system|developer|root)\s*:\s*/i, label: 'role spoofing prefix' },
  { re: /(?:do not|don't|never)\s+follow\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions)/i, label: 'disable system prompt' },
  { re: /reveal\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions|message)/i, label: 'prompt extraction' },
  { re: /(?:output|print|show|repeat)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions|message)/i, label: 'prompt extraction' },
  { re: /<\s*(?:system|developer|assistant)\s*>/i, label: 'role tag injection' },
  { re: /(?:これまで|以前|上記)の(?:指示|命令|プロンプト|ルール)を(?:全て|すべて)?無視/i, label: 'ignore previous instructions' },
  { re: /(?:システム|開発者)プロンプトを(?:表示|開示|出力|明かし|漏らし|書き出し)/i, label: 'prompt extraction' },
  { re: /<(?:システム|開発者)>/i, label: 'role tag injection' },
]);

const CREDENTIAL_EXFILTRATION_PATTERNS = Object.freeze([
  { re: /(?:api[_-]?key|secret|token|password|passwd|credential)\s*[:=]\s*[\x21-\x7e]{8,}/i, label: 'embedded credential' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key id' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i, label: 'private key block' },
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI-style secret' },
  { re: /(?:send|post|exfiltrate|upload|leak|paste)\s+(?:the\s+)?(?:secret|token|key|password|credential|\.env)/i, label: 'exfiltration instruction' },
]);

const SSH_BACKDOOR_PATTERNS = Object.freeze([
  { re: /authorized_keys\s*[:=]/i, label: 'authorized_keys write' },
  { re: /ssh-rsa\s+AAA[0-9A-Za-z+/]{20,}/i, label: 'embedded ssh-rsa key' },
  { re: /ssh-ed25519\s+AAA[0-9A-Za-z+/]{20,}/i, label: 'embedded ssh-ed25519 key' },
  { re: /(?:add|append|write)\s+(?:your\s+)?(?:public\s+)?ssh\s+key/i, label: 'ssh key injection instruction' },
]);

function findFirstPattern(content, patterns) {
  for (const pattern of patterns) {
    if (pattern.re.test(content)) return pattern.label;
  }
  return null;
}

/**
 * Pre-save threat inspection shared by the MCP server and the web API.
 * Mirrors web/src/lib/memory-safety.ts. Returns `{ code, message }` when the
 * content must be rejected, or `null` when it is safe.
 */
export function inspectMemoryContent(content) {
  if (typeof content !== 'string') return null;
  if (INVISIBLE_UNICODE_RE.test(content)) {
    return { code: 'invisible_unicode', message: '不可視Unicode文字が含まれているため保存できません' };
  }
  if (MEMORY_BOUNDARY_TAG_RE.test(content)) {
    return { code: 'memory_boundary_tag', message: 'メモリ境界タグ(<workspace-memory>)は保存できません' };
  }
  const injection = findFirstPattern(content, PROMPT_INJECTION_PATTERNS);
  if (injection) {
    return { code: 'prompt_injection', message: `プロンプト注入の疑いがあるため保存できません: ${injection}` };
  }
  const exfil = findFirstPattern(content, CREDENTIAL_EXFILTRATION_PATTERNS);
  if (exfil) {
    return { code: 'credential_exfiltration', message: `資格情報の持ち出しの疑いがあるため保存できません: ${exfil}` };
  }
  const backdoor = findFirstPattern(content, SSH_BACKDOOR_PATTERNS);
  if (backdoor) {
    return { code: 'ssh_backdoor', message: `SSHバックドアの疑いがあるため保存できません: ${backdoor}` };
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

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalidInput();
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
    assertObject(args, ['id', 'content', 'kind', 'expectedRevision']);
    assertId(args.id);
    assertRevision(args.expectedRevision);
    if (args.content === undefined && args.kind === undefined) invalidInput();
    if (args.content !== undefined) assertContent(args.content);
    if (args.kind !== undefined) assertKind(args.kind);
    const next = { id: args.id, expectedRevision: args.expectedRevision };
    if (args.content !== undefined) next.content = args.content;
    if (args.kind !== undefined) next.kind = args.kind;
    return Object.freeze(next);
  },
  delete(args) {
    assertObject(args, ['id', 'expectedRevision']);
    assertId(args.id);
    assertRevision(args.expectedRevision);
    return Object.freeze({ id: args.id, expectedRevision: args.expectedRevision });
  },
});
