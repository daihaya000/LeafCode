import { useState } from "react";
import type { ChatTab, SidePanelKind } from "@/lib/side-panel-state";

export const SIDE_DEFAULT = 520;

/**
 * TaskView のパネル/表示状態（REFACTORING_PLAN 5-b / IMPROVEMENT 1-1）。
 * 表示のみの state を集約し、TaskView 本体の useState 数を減らす。
 * 副作用を持たないため、TaskView から安全に切り出せる最初のクラスタ。
 */
export function useTaskPanels() {
  const [tab, setTab] = useState<ChatTab>("chat");
  const [viewTab, setViewTab] = useState<"chat" | "workflow" | "diff">("chat");
  const [workflowFocusNode, setWorkflowFocusNode] = useState<string | null>(null);
  // セッションを開いたとき右ペインは閉じた状態がデフォルト。
  const [showDiff, setShowDiff] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanelKind>("graph");
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT);
  const [sideResizing, setSideResizing] = useState(false);
  const [viewportIsLg, setViewportIsLg] = useState(false);
  // Initialize from the actual matchMedia to avoid desktop permanent collapse
  // (isMd starts false on SSR/first paint, causing initialCollapsed=true on desktop).
  const [isMd, setIsMd] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [diffKey, setDiffKey] = useState(0);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [filteredFilesCount, setFilteredFilesCount] = useState<number | null>(null);

  return {
    tab,
    setTab,
    viewTab,
    setViewTab,
    workflowFocusNode,
    setWorkflowFocusNode,
    showDiff,
    setShowDiff,
    sidePanel,
    setSidePanel,
    sideWidth,
    setSideWidth,
    sideResizing,
    setSideResizing,
    viewportIsLg,
    setViewportIsLg,
    isMd,
    setIsMd,
    diffKey,
    setDiffKey,
    focusFile,
    setFocusFile,
    filteredFilesCount,
    setFilteredFilesCount,
  };
}
