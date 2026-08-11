"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Highlight `/skill-name` and `@agent-name` tokens inside a rendered user
 * message. Both known and unknown tokens render in accent blue so the
 * composer's inline highlight matches what the user sees after sending.
 *
 * Pure / structural — no network. Hover titles (skill/agent overviews) are
 * injected by the parent via the optional `skills` / `agents` maps when
 * available; when a token isn't in the map the title is omitted.
 */

type Token = {
  kind: "skill" | "agent";
  text: string;
  name: string;
  title?: string;
};

function tokenize(
  text: string,
  skills: ReadonlyMap<string, string> | undefined,
  agents: ReadonlyMap<string, string> | undefined,
): Token[] {
  const re = /(^|[\s])([\/@])([A-Za-z0-9._-]+)/g;
  const tokens: Token[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const sigil = match[2] ?? "";
    const name = match[3] ?? "";
    const start = match.index + prefix.length;
    if (start > last) {
      tokens.push({ kind: "skill", text: text.slice(last, start), name: "" });
    }
    const full = sigil + name;
    const kind: "skill" | "agent" = sigil === "@" ? "agent" : "skill";
    const title =
      kind === "skill"
        ? skills?.get(name.toLowerCase())
        : agents?.get(name.toLowerCase());
    // Only highlight tokens known as skills/agents. Unknown `/foo` and `@bar`
    // stay plain so the message doesn't light up arbitrary slash commands or
    // email-style addresses.
    if (title !== undefined || (kind === "skill" && skills?.has(name.toLowerCase())) || (kind === "agent" && agents?.has(name.toLowerCase()))) {
      tokens.push({
        kind,
        text: full,
        name,
        ...(title ? { title } : {}),
      });
    } else {
      tokens.push({ kind, text: full, name: "" });
    }
    last = start + full.length;
  }
  if (last < text.length) {
    tokens.push({ kind: "skill", text: text.slice(last), name: "" });
  }
  return tokens;
}

export function MessageTokenHighlight({
  text,
  skills,
  agents,
}: {
  text: string;
  /** Lowercased skill name → overview. */
  skills?: ReadonlyMap<string, string>;
  /** Lowercased agent name → overview. */
  agents?: ReadonlyMap<string, string>;
}): ReactNode {
  const tokens = tokenize(text, skills, agents);
  return (
    <>
      {tokens.map((token, index) =>
        token.name ? (
          <span
            key={`tk-${index}-${token.kind}-${token.name}`}
            className="font-medium text-accent"
            title={token.title}
          >
            {token.text}
          </span>
        ) : (
          <Fragment key={`tx-${index}`}>{token.text}</Fragment>
        ),
      )}
    </>
  );
}