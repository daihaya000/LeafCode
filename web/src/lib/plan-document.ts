import type { MessageWithParts } from "./types";

function pathOnly(text: string): string | null {
  let value = text.trim();
  if (value.startsWith("`") && value.endsWith("`") && value.length > 2) {
    value = value.slice(1, -1).trim();
  }
  if (value.includes("\n") || !/\.md$/i.test(value)) return null;
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(value) ? value : null;
}

export function extractPlanMarkdownPath(message: MessageWithParts): string | null {
  if (
    message.info.role !== "assistant" ||
    message.info.agent !== "plan" ||
    !message.info.time?.completed
  ) return null;

  const candidates = message.parts.flatMap((part) => {
    if (part.type === "file" && part.filename) return [pathOnly(part.filename)];
    if (part.type === "text" && part.text) return [pathOnly(part.text)];
    return [];
  }).filter((candidate): candidate is string => Boolean(candidate));

  return new Set(candidates).size === 1 ? candidates[0] : null;
}
