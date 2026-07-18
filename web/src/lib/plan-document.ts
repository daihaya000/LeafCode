import type { MessageWithParts } from "./types";

/** Prompt sent to the Build agent when a plan is approved. Shared so approval
 *  detection stays in lockstep with what TaskView submits. */
export const PLAN_APPROVAL_PROMPT =
  "この計画を承認します。計画に従って実装を開始してください。";

function isAbsolutePlanPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(value);
}

function pathOnly(text: string): string | null {
  let value = text.trim();
  if (value.startsWith("`") && value.endsWith("`") && value.length > 2) {
    value = value.slice(1, -1).trim();
  }
  if (value.includes("\n") || !/\.md$/i.test(value)) return null;
  return isAbsolutePlanPath(value) ? value : null;
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

/** Whether the plan identified by `planMessageId` has already been approved in
 *  this session. Approval is durable in the message history: a user message
 *  carrying the exact approval prompt after the plan means Build was started,
 *  so the plan must not be approvable again after reload/remount. */
export function isPlanApproved(
  messages: MessageWithParts[],
  planMessageId: string,
): boolean {
  const planIndex = messages.findIndex((m) => m.info.id === planMessageId);
  if (planIndex < 0) return false;

  for (let i = planIndex + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.info.role !== "user") continue;
    const approved = message.parts.some(
      (part) =>
        part.type === "text" && part.text?.trim() === PLAN_APPROVAL_PROMPT,
    );
    if (!approved) continue;
    const agent = message.info.agent;
    if (agent && agent !== "build") continue;
    return true;
  }
  return false;
}
