/**
 * Right-side panel display state (which panel, whether visible, chat/diff tab).
 * Persisted to localStorage so switching tasks/sessions preserves the user's
 * last choice (e.g. "tree view selected" stays selected).
 */

const SIDE_PANEL_KEY = "webui:side-panel";
const SHOW_DIFF_KEY = "webui:side-show";
const TAB_KEY = "webui:side-tab";

export type SidePanelKind = "diff" | "files" | "pty" | "graph";
export type ChatTab = "chat" | "diff";

export function readSidePanel(): SidePanelKind {
  if (typeof window === "undefined") return "graph";
  try {
    const raw = localStorage.getItem(SIDE_PANEL_KEY);
    if (
      raw === "diff" ||
      raw === "files" ||
      raw === "pty" ||
      raw === "graph"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "graph";
}

export function writeSidePanel(kind: SidePanelKind): void {
  try {
    localStorage.setItem(SIDE_PANEL_KEY, kind);
  } catch {
    /* ignore */
  }
}

export function readShowDiff(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(SHOW_DIFF_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function writeShowDiff(show: boolean): void {
  try {
    localStorage.setItem(SHOW_DIFF_KEY, show ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readChatTab(): ChatTab {
  if (typeof window === "undefined") return "chat";
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw === "chat" || raw === "diff") return raw;
  } catch {
    /* ignore */
  }
  return "chat";
}

export function writeChatTab(tab: ChatTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}