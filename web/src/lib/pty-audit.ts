/**
 * PTY audit logging.
 *
 * PTY creation / termination / abnormal disconnect are security-sensitive
 * events (arbitrary command execution equivalent). We log them as
 * single-line JSON to stdout, which the tray host's tee captures into its
 * ring buffer + disk log (`host.log`) under the `[webui]` prefix. This makes
 * the events visible in the host-log viewer without a dedicated audit store.
 *
 * The log line is a compact JSON object so it can be parsed later if needed,
 * but stays human-readable in the raw log.
 */

export type PtyAuditEvent =
  | "create"
  | "delete"
  | "disconnect"
  | "resize"
  | "create-error";

interface PtyAuditEntry {
  pty: string;
  event: PtyAuditEvent;
  directory?: string;
  detail?: string;
}

/** Emit a PTY audit event to stdout (captured by the host tee). */
export function logPtyEvent(
  ptyId: string,
  event: PtyAuditEvent,
  fields?: { directory?: string; detail?: string },
): void {
  const entry: PtyAuditEntry = {
    pty: ptyId,
    event,
  };
  if (fields?.directory) entry.directory = fields.directory;
  if (fields?.detail) entry.detail = fields.detail;
  // Single-line JSON so the host log buffer keeps it as one entry.
  console.log(`pty-audit ${JSON.stringify(entry)}`);
}