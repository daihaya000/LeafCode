/**
 * Right-side panel display state (which panel, whether visible, chat/diff tab).
 * Persisted to localStorage so switching tasks/sessions preserves the user's
 * last choice (e.g. "tree view selected" stays selected).
 *
 * Keys follow the `webui:` + kebab-case convention with one feature = one
 * prefix (`webui:side-panel:*`, IMPROVEMENT 9-1b). Legacy flat keys
 * (`webui:side-panel` / `webui:side-show` / `webui:side-tab`) are still read
 * as fallbacks so existing users keep their preference; writes use the new
 * keys only.
 */

const SIDE_PANEL_PREFIX = "webui:side-panel";
const KIND_KEY = `${SIDE_PANEL_PREFIX}:kind`;
const SHOW_DIFF_KEY = `${SIDE_PANEL_PREFIX}:show-diff`;
const TAB_KEY = `${SIDE_PANEL_PREFIX}:tab`;

/** Legacy flat keys, read as fallbacks (IMPROVEMENT 9-1b). */
const LEGACY_KIND_KEY = "webui:side-panel";
const LEGACY_SHOW_DIFF_KEY = "webui:side-show";
const LEGACY_TAB_KEY = "webui:side-tab";

export type SidePanelKind = "diff" | "files" | "pty" | "graph" | "markdown";
export type ChatTab = "chat" | "diff";

function isSidePanelKind(raw: string | null): raw is SidePanelKind {
  return (
    raw === "diff" ||
    raw === "files" ||
    raw === "pty" ||
    raw === "graph" ||
    raw === "markdown"
  );
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function readSidePanel(): SidePanelKind {
  if (typeof window === "undefined") return "graph";
  const raw = readItem(KIND_KEY) ?? readItem(LEGACY_KIND_KEY);
  return isSidePanelKind(raw) ? raw : "graph";
}

export function writeSidePanel(kind: SidePanelKind): void {
  writeItem(KIND_KEY, kind);
}

export function readShowDiff(): boolean {
  if (typeof window === "undefined") return true;
  const raw = readItem(SHOW_DIFF_KEY) ?? readItem(LEGACY_SHOW_DIFF_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return true;
}

export function writeShowDiff(show: boolean): void {
  writeItem(SHOW_DIFF_KEY, show ? "1" : "0");
}

export function readChatTab(): ChatTab {
  if (typeof window === "undefined") return "chat";
  const raw = readItem(TAB_KEY) ?? readItem(LEGACY_TAB_KEY);
  if (raw === "chat" || raw === "diff") return raw;
  return "chat";
}

export function writeChatTab(tab: ChatTab): void {
  writeItem(TAB_KEY, tab);
}
