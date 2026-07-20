/** Active TaskView session pending permission/question — for Sidebar badges. */

export type ActiveSessionAttention = {
  sessionId: string;
  permissions: number;
  questions: number;
};

let current: ActiveSessionAttention | null = null;

export function setActiveSessionAttention(
  next: ActiveSessionAttention | null,
) {
  const same =
    (current === null && next === null) ||
    (current !== null &&
      next !== null &&
      current.sessionId === next.sessionId &&
      current.permissions === next.permissions &&
      current.questions === next.questions);
  if (same) return;
  current = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("webui:active-session-attention", { detail: next }),
    );
  }
}

export function getActiveSessionAttention(): ActiveSessionAttention | null {
  return current;
}
