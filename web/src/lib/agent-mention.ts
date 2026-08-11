/**
 * @-mention parse / filter helpers for composer agent autocomplete.
 *
 * Mirrors slash-command.ts: locate an active `@token` immediately before the
 * cursor, filter agent candidates, and apply a completion. Also provides
 * highlight segmentation so the composer can render `@agent-name` tokens in
 * accent blue with a hover title carrying the agent overview.
 */

export type AgentMention = {
  /** Stable identifier — the agent name as the engine knows it. */
  name: string;
  /** Display label (role when parseable, otherwise the raw name). */
  label: string;
  /** Short overview shown as secondary text / hover title. */
  description?: string;
  /** "primary" / "subagent" / "all" — used only for the badge tone. */
  mode?: "primary" | "subagent" | "all";
};

export type AtQuery = {
  /** Index of the leading `@`. */
  start: number;
  /** Cursor index (end of the partial token). */
  end: number;
  /** Text after `@` (may be empty). */
  query: string;
};

/** Detect an active `@token` immediately before the cursor. */
export function parseAtQuery(text: string, cursor: number): AtQuery | null {
  if (cursor < 1 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s])@([^\s@]*)$/);
  if (!match) return null;
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  return {
    start,
    end: cursor,
    query: match[2] ?? "",
  };
}

/** Prefix matches first, then substring; capped for the menu. */
export function filterAgents(
  agents: AgentMention[],
  query: string,
  limit = 12,
): AgentMention[] {
  const q = query.toLowerCase();
  const scored = agents
    .filter((a) => {
      if (!a.name) return false;
      if (!q) return true;
      const name = a.name.toLowerCase();
      const label = (a.label ?? "").toLowerCase();
      return name.startsWith(q) || name.includes(q) || label.includes(q);
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

/** Replace the active `@partial` with `@name ` and place the cursor after it. */
export function applyAgentCompletion(
  text: string,
  query: AtQuery,
  agentName: string,
): { text: string; cursor: number } {
  const insert = `@${agentName} `;
  const after = text.slice(query.end);
  const rest = after.startsWith(" ") || after.startsWith("\n") ? after.slice(1) : after;
  const next = text.slice(0, query.start) + insert + rest;
  return { text: next, cursor: query.start + insert.length };
}

export type AgentTokenRange = {
  start: number;
  end: number;
  name: string;
  label: string;
  description?: string;
};

/** Agent names use the same safe charset as skill names. */
const TOKEN_CHARS = /[A-Za-z0-9._-]/;

/** Locate whole `@agent-name` tokens that match known agents. */
export function findAgentTokens(
  text: string,
  agents: AgentMention[],
): AgentTokenRange[] {
  const byName = new Map<string, AgentMention>();
  for (const agent of agents) {
    if (!agent.name) continue;
    byName.set(agent.name.toLowerCase(), agent);
  }
  if (byName.size === 0 || !text) return [];

  const tokens: AgentTokenRange[] = [];
  const re = /(^|[\s])@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const raw = match[2] ?? "";
    // Trim trailing characters that can't belong to an agent name so tokens
    // immediately followed by punctuation (e.g. "@plan!") still resolve.
    let end = raw.length;
    while (end > 0 && !TOKEN_CHARS.test(raw[end - 1])) end -= 1;
    const name = raw.slice(0, end);
    if (!name) continue;
    const atIndex = match.index + prefix.length;
    const agent = byName.get(name.toLowerCase());
    if (!agent) continue;
    tokens.push({
      start: atIndex,
      end: atIndex + 1 + name.length,
      name: agent.name,
      label: agent.label ?? agent.name,
      ...(agent.description ? { description: agent.description } : {}),
    });
  }
  return tokens;
}

export type AgentHighlightSegment =
  | { kind: "text"; text: string }
  | {
      kind: "agent";
      text: string;
      name: string;
      label: string;
      description?: string;
    };

/** Split text into plain / agent segments for composer highlighting. */
export function segmentAgentHighlights(
  text: string,
  agents: AgentMention[],
): AgentHighlightSegment[] {
  const tokens = findAgentTokens(text, agents);
  if (tokens.length === 0) {
    return text ? [{ kind: "text", text }] : [];
  }
  const segments: AgentHighlightSegment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, token.start) });
    }
    segments.push({
      kind: "agent",
      text: text.slice(token.start, token.end),
      name: token.name,
      label: token.label,
      ...(token.description ? { description: token.description } : {}),
    });
    cursor = token.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

/** Agent overview for the token under `cursor`, or undefined. */
export function agentDescriptionAt(
  text: string,
  agents: AgentMention[],
  cursor?: number,
): string | undefined {
  const tokens = findAgentTokens(text, agents);
  if (tokens.length === 0) return undefined;
  if (cursor === undefined) {
    return tokens[0]?.description;
  }
  const hit = tokens.find(
    (token) => cursor >= token.start && cursor <= token.end,
  );
  return hit?.description;
}

/**
 * Unified highlight segment — the composer renders both `/skill` and `@agent`
 * tokens in accent blue with a single mirror pass.
 */
export type HighlightSegment =
  | { kind: "text"; text: string }
  | {
      kind: "skill";
      text: string;
      name: string;
      description?: string;
    }
  | {
      kind: "agent";
      text: string;
      name: string;
      label: string;
      description?: string;
    };

type SkillRange = {
  start: number;
  end: number;
  name: string;
  description?: string;
};

type RawRange = {
  start: number;
  end: number;
  seg: HighlightSegment;
};

/**
 * Merge skill and agent token ranges into a single ordered highlight segment
 * list. Skill tokens come from `findSkillTokens` (imported from slash-command)
 * and agent tokens from `findAgentTokens`; the two never overlap because a
 * token starts with either `/` or `@`.
 */
export function segmentHighlights(
  text: string,
  skillRanges: SkillRange[],
  agents: AgentMention[],
): HighlightSegment[] {
  const agentRanges = findAgentTokens(text, agents);
  if (skillRanges.length === 0 && agentRanges.length === 0) {
    return text ? [{ kind: "text", text }] : [];
  }

  const ranges: RawRange[] = [];
  for (const token of skillRanges) {
    ranges.push({
      start: token.start,
      end: token.end,
      seg: {
        kind: "skill",
        text: text.slice(token.start, token.end),
        name: token.name,
        ...(token.description ? { description: token.description } : {}),
      },
    });
  }
  for (const token of agentRanges) {
    ranges.push({
      start: token.start,
      end: token.end,
      seg: {
        kind: "agent",
        text: text.slice(token.start, token.end),
        name: token.name,
        label: token.label,
        ...(token.description ? { description: token.description } : {}),
      },
    });
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // defensive: never overlaps in practice
    if (range.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, range.start) });
    }
    segments.push(range.seg);
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}