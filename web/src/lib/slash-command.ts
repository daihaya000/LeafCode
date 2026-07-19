/** Slash-command parse / filter helpers for composer autocomplete. */

export type SlashCommand = {
  name: string;
  description?: string;
  source?: string;
};

export type SlashQuery = {
  /** Index of the leading `/`. */
  start: number;
  /** Cursor index (end of the partial token). */
  end: number;
  /** Text after `/` (may be empty). */
  query: string;
};

export type ParsedCommandSubmit = {
  command: string;
  arguments: string;
};

/** Detect an active `/token` immediately before the cursor. */
export function parseSlashQuery(
  text: string,
  cursor: number,
): SlashQuery | null {
  if (cursor < 1 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s])\/([^\s]*)$/);
  if (!match) return null;
  const start = before.lastIndexOf("/");
  if (start < 0) return null;
  return {
    start,
    end: cursor,
    query: match[2] ?? "",
  };
}

/** Prefix matches first, then substring; capped for the menu. */
export function filterCommands(
  commands: SlashCommand[],
  query: string,
  limit = 12,
): SlashCommand[] {
  const q = query.toLowerCase();
  const scored = commands
    .filter((c) => {
      if (!c.name) return false;
      if (!q) return true;
      const name = c.name.toLowerCase();
      return name.startsWith(q) || name.includes(q);
    })
    .sort((a, b) => {
      if (q) {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aPrefix = aName.startsWith(q) ? 0 : 1;
        const bPrefix = bName.startsWith(q) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      }
      return a.name.localeCompare(b.name);
    });
  return scored.slice(0, limit);
}

/** Replace the active `/partial` with `/name ` and place the cursor after it. */
export function applySlashCompletion(
  text: string,
  query: SlashQuery,
  commandName: string,
): { text: string; cursor: number } {
  const insert = `/${commandName} `;
  const after = text.slice(query.end);
  // Avoid a double space when the cursor sits just before existing whitespace.
  const rest = after.startsWith(" ") || after.startsWith("\n") ? after.slice(1) : after;
  const next = text.slice(0, query.start) + insert + rest;
  return { text: next, cursor: query.start + insert.length };
}

/**
 * If `text` starts with a known `/command`, return it for session.command.
 * Unknown `/foo` returns null so callers fall back to a normal prompt.
 */
export function parseCommandSubmit(
  text: string,
  commands: SlashCommand[],
): ParsedCommandSubmit | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const name = match[1] ?? "";
  if (!name) return null;
  const known = commands.some((c) => c.name === name);
  if (!known) return null;
  return {
    command: name,
    arguments: match[2] ?? "",
  };
}

/** Normalize OpenCode `/command` JSON into SlashCommand[]. */
export function normalizeCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: SlashCommand[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { name, description, source } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({
      name: name.trim(),
      ...(typeof description === "string" && description
        ? { description }
        : {}),
      ...(typeof source === "string" && source ? { source } : {}),
    });
  }
  return out;
}
