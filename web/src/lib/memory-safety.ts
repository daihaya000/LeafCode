/**
 * Pre-save threat inspection for the memory layer.
 *
 * Memory rows are injected into future prompts, so any write path (web API,
 * auto-extraction, MCP `memory_add`) must reject content that could break the
 * prompt boundary or exfiltrate credentials. This module is deliberately
 * framework-free (no `./db` import) so the MCP server can mirror it from the
 * shared browser-bridge schema without pulling node-only deps.
 *
 * See docs/specs/memory-layer.md 「プロンプト汚染対策」 and the Hermes-style
 * security scanning reference.
 */

export type MemorySafetyViolation = {
  /** Machine-readable reason code. */
  code:
    | "invisible_unicode"
    | "memory_boundary_tag"
    | "prompt_injection"
    | "credential_exfiltration"
    | "ssh_backdoor";
  /** Human-readable explanation (Japanese, surfaced via API errors / audit). */
  message: string;
};

const INVISIBLE_UNICODE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/;

const MEMORY_BOUNDARY_TAG_RE = /<\/?workspace-memory>/i;

// Prompt-injection signals. We match on directives that attempt to override
// the system prompt or the injected boundary's "reference only" contract.
const PROMPT_INJECTION_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i, label: "ignore previous instructions" },
  { re: /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i, label: "disregard previous instructions" },
  { re: /you\s+are\s+(?:now|actually)\s+(?:a|an)\s+/i, label: "identity override" },
  { re: /(?:system|developer|root)\s*:\s*/i, label: "role spoofing prefix" },
  { re: /(?:do not|don't|never)\s+follow\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions)/i, label: "disable system prompt" },
  { re: /reveal\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions|message)/i, label: "prompt extraction" },
  { re: /(?:output|print|show|repeat)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|instructions|message)/i, label: "prompt extraction" },
  { re: /<\s*(?:system|developer|assistant)\s*>/i, label: "role tag injection" },
];

// Credential exfiltration signals. Matches common secret shapes and
// instructions to send secrets somewhere.
const CREDENTIAL_EXFILTRATION_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /(?:api[_-]?key|secret|token|password|passwd|credential)\s*[:=]\s*[\x21-\x7e]{8,}/i, label: "embedded credential" },
  { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i, label: "private key block" },
  { re: /sk-[A-Za-z0-9]{20,}/, label: "OpenAI-style secret" },
  { re: /(?:send|post|exfiltrate|upload|leak|paste)\s+(?:the\s+)?(?:secret|token|key|password|credential|\.env)/i, label: "exfiltration instruction" },
];

const SSH_BACKDOOR_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /authorized_keys\s*[:=]/i, label: "authorized_keys write" },
  { re: /ssh-rsa\s+AAA[0-9A-Za-z+/]{20,}/i, label: "embedded ssh-rsa key" },
  { re: /ssh-ed25519\s+AAA[0-9A-Za-z+/]{20,}/i, label: "embedded ssh-ed25519 key" },
  { re: /(?:add|append|write)\s+(?:your\s+)?(?:public\s+)?ssh\s+key/i, label: "ssh key injection instruction" },
];

function findFirst(
  content: string,
  patterns: ReadonlyArray<{ re: RegExp; label: string }>,
): { label: string } | null {
  for (const pattern of patterns) {
    if (pattern.re.test(content)) return { label: pattern.label };
  }
  return null;
}

/**
 * Inspect memory content before it is persisted. Returns the first violation
 * found, or `null` when the content is safe. The check is pure and synchronous
 * so it can run inside a SQLite transaction without side effects.
 */
export function inspectMemoryContent(content: string): MemorySafetyViolation | null {
  if (INVISIBLE_UNICODE_RE.test(content)) {
    return {
      code: "invisible_unicode",
      message: "不可視Unicode文字が含まれているため保存できません",
    };
  }
  if (MEMORY_BOUNDARY_TAG_RE.test(content)) {
    return {
      code: "memory_boundary_tag",
      message: "メモリ境界タグ(<workspace-memory>)は保存できません",
    };
  }
  const injection = findFirst(content, PROMPT_INJECTION_PATTERNS);
  if (injection) {
    return {
      code: "prompt_injection",
      message: `プロンプト注入の疑いがあるため保存できません: ${injection.label}`,
    };
  }
  const exfil = findFirst(content, CREDENTIAL_EXFILTRATION_PATTERNS);
  if (exfil) {
    return {
      code: "credential_exfiltration",
      message: `資格情報の持ち出しの疑いがあるため保存できません: ${exfil.label}`,
    };
  }
  const backdoor = findFirst(content, SSH_BACKDOOR_PATTERNS);
  if (backdoor) {
    return {
      code: "ssh_backdoor",
      message: `SSHバックドアの疑いがあるため保存できません: ${backdoor.label}`,
    };
  }
  return null;
}