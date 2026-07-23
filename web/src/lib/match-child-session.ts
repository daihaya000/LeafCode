export type ChildSessionRef = {
  id: string;
  title?: string;
};

export type TaskMatchHint = {
  callID?: string;
  metadata?: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  siblingTaskCallIds: string[];
};

const TIMELINE_PART_TYPES = new Set([
  "text",
  "tool",
  "reasoning",
  "file",
  "patch",
  "agent",
]);

export function isTaskToolName(tool: string): boolean {
  const t = tool.toLowerCase();
  return t === "task" || t.includes("task");
}

export function extractSessionIdFromMetadata(
  metadata?: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of ["sessionID", "sessionId", "session_id"] as const) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function normalizeMatchTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hintTitle(input?: Record<string, unknown> | null): string | null {
  if (!input) return null;
  return (
    asNonEmptyString(input.description) ??
    asNonEmptyString(input.prompt)?.slice(0, 120) ??
    null
  );
}

export function collectTaskCallIds(
  messages: {
    parts: { type?: string; tool?: string; callID?: string; text?: string }[];
  }[],
): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") continue;
      if (!part.tool || !isTaskToolName(part.tool)) continue;
      if (!part.callID) continue;
      ids.push(part.callID);
    }
  }
  return ids;
}

export function messageHasTimelineParts(
  parts: { type?: string; text?: string }[],
): boolean {
  return parts.some((p) => {
    if (!p.type || !TIMELINE_PART_TYPES.has(p.type)) return false;
    if (p.type === "text") return Boolean(p.text?.trim());
    return true;
  });
}

export function isTimelinePartType(type: string): boolean {
  return TIMELINE_PART_TYPES.has(type);
}

/** Resolve one child session for a task tool hint. */
export function matchChildSession(
  children: ChildSessionRef[],
  hint: TaskMatchHint,
  stickyId?: string | null,
): string | null {
  if (children.length === 0) return null;

  const byId = new Map(children.map((c) => [c.id, c]));

  // Explicit metadata from the tool part always wins over a sticky guess.
  const explicit = extractSessionIdFromMetadata(hint.metadata ?? null);
  if (explicit && byId.has(explicit)) return explicit;

  if (stickyId && byId.has(stickyId)) return stickyId;

  const title = hintTitle(hint.input ?? null);
  if (title) {
    const needle = normalizeMatchTitle(title);
    const matches = children.filter(
      (c) => c.title && normalizeMatchTitle(c.title) === needle,
    );
    if (matches.length === 1) return matches[0]!.id;
  }

  // Do not map sibling task-call order onto children sorted by id — those
  // sequences are unrelated and previously sticky-matched the wrong child.
  // Also do not auto-map a single child: when only one child exists, it may
  // be incorrectly matched as the parent's own session (R18).
  return null;
}
