import type { MessageWithParts } from "./types";

const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_TITLE = 60;

/** Plain-text transcript from user/assistant text parts, latest-preferring. */
export function buildTranscript(
  messages: MessageWithParts[],
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.info.role !== "user" && m.info.role !== "assistant") continue;
    const text = m.parts
      .filter((p) => p.type === "text" && !p.synthetic && p.text)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    const label = m.info.role === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${text}`);
  }
  const full = lines.join("\n\n");
  if (full.length <= maxChars) return full;
  // Keep the latest content: slice from the end.
  return full.slice(full.length - maxChars);
}

/** One trimmed line, no wrapping quotes/markdown, capped by code points. */
export function sanitizeTitle(
  raw: string,
  maxCodePoints: number = DEFAULT_MAX_TITLE,
): string {
  const firstLine = (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  let s = firstLine;
  // strip surrounding quotes / brackets, repeatedly — an LLM-generated title
  // can come back double-wrapped (e.g. `"“Fix login bug”"`), and stopping
  // after one pair left the inner one in place.
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["「", "」"],
    ["『", "』"],
  ];
  for (let guard = 0; guard < 5; guard++) {
    const before = s;
    for (const [open, close] of pairs) {
      if (s.startsWith(open) && s.endsWith(close) && s.length >= open.length + close.length) {
        s = s.slice(open.length, s.length - close.length).trim();
        break;
      }
    }
    if (s === before) break;
  }
  const cps = Array.from(s);
  if (cps.length > maxCodePoints) s = cps.slice(0, maxCodePoints).join("");
  return s.trim();
}

/** Newest assistant model info, or null. */
export function latestModelFromMessages(
  messages: MessageWithParts[],
): { providerID: string; modelID: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info;
    if (info.providerID && info.modelID) {
      return { providerID: info.providerID, modelID: info.modelID };
    }
  }
  return null;
}
