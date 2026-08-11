"use client";

import { useState } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import dynamic from "next/dynamic";
import { CommandPalette } from "@/components/CommandPalette";
import { TASK_DRAG_MIME } from "@/lib/task-drag";
import {
  ShellProvider,
  useShellActiveScope,
  useShellExtras,
  useShellMobileNav,
} from "./ShellContext";
import { Sidebar } from "./Sidebar";
import { GlobalAttentionProvider } from "./GlobalAttentionProvider";
import { AttentionQueueModal } from "./AttentionQueueModal";
import { MobileScrollTargetProvider } from "./MobileScrollTargetContext";
import { TaskSplitProvider, useTaskSplit } from "./TaskSplitContext";

const SplitTaskView = dynamic(
  () => import("@/components/task/TaskView").then((module) => module.TaskView),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-full items-center justify-center text-xs text-muted"
      >
        タスクを読み込み中...
      </div>
    ),
  },
);

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { extras } = useShellExtras();
  const activeScope = useShellActiveScope();
  const { mobileNavOpen, closeMobileNav } = useShellMobileNav();
  const {
    desktopSplitEnabled,
    splitHostEnabled,
    primaryTaskId,
    secondaryTaskId,
    activeTaskId,
    splitActive,
    openSplit,
    openSplitLeft,
    closeSplit,
    activatePrimary,
    activateTask,
  } = useTaskSplit();
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const showDropTargets = Boolean(
    desktopSplitEnabled &&
      splitHostEnabled &&
      draggingTaskId &&
      draggingTaskId !== primaryTaskId &&
      draggingTaskId !== secondaryTaskId,
  );

  return (
    <GlobalAttentionProvider activeScope={activeScope}>
      <MobileScrollTargetProvider>
        <div
          className="flex h-dvh flex-col bg-bg text-text md:flex-row"
          onDragStart={(event) => {
            if (!desktopSplitEnabled) return;
            const taskId = event.dataTransfer.getData(TASK_DRAG_MIME);
            if (taskId) setDraggingTaskId(taskId);
          }}
          onDragEnd={() => setDraggingTaskId(null)}
        >
          <CommandPalette directory={extras.directory} onFile={extras.onFile} />

          <Sidebar mobileOpen={mobileNavOpen} onClose={closeMobileNav} />

          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <section
              aria-label={splitActive ? "左ペイン" : "メインコンテンツ"}
              data-active={
                splitActive && activeTaskId === primaryTaskId ? "true" : undefined
              }
              className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              onPointerDown={activatePrimary}
              onFocusCapture={activatePrimary}
            >
              {splitActive && activeTaskId === primaryTaskId && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-[70] h-0.5 bg-accent"
                />
              )}
              {children}
            </section>

            {splitActive && secondaryTaskId && (
              <section
                aria-label="右ペイン"
                data-active={activeTaskId === secondaryTaskId ? "true" : "false"}
                className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l-2 border-border-strong"
                onPointerDown={() => activateTask(secondaryTaskId)}
                onFocusCapture={() => activateTask(secondaryTaskId)}
              >
                {activeTaskId === secondaryTaskId && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 z-[70] h-0.5 bg-accent"
                  />
                )}
                <SplitTaskView
                  key={secondaryTaskId}
                  taskId={secondaryTaskId}
                  onCloseSplit={closeSplit}
                />
              </section>
            )}

            {showDropTargets && (
              <div
                role="region"
                aria-label="タスクを左ペインに表示"
                data-testid="task-split-drop-zone-left"
                className="absolute inset-y-3 right-1/2 left-3 z-[90] mr-1.5 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-bg/90 p-6 text-accent shadow-xl backdrop-blur-sm"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId =
                    event.dataTransfer.getData(TASK_DRAG_MIME) || draggingTaskId;
                  if (taskId) openSplitLeft(taskId);
                  setDraggingTaskId(null);
                }}
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
                    <PanelLeft className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold">
                    ここにドロップして左に表示
                  </span>
                  <span className="text-xs text-muted">
                    左ペインだけを差し替えます
                  </span>
                </div>
              </div>
            )}

            {showDropTargets && (
              <div
                role="region"
                aria-label="タスクを右ペインに表示"
                data-testid="task-split-drop-zone-right"
                className="absolute inset-y-3 right-3 left-1/2 z-[90] ml-1.5 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-bg/90 p-6 text-accent shadow-xl backdrop-blur-sm"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId =
                    event.dataTransfer.getData(TASK_DRAG_MIME) || draggingTaskId;
                  if (taskId) openSplit(taskId);
                  setDraggingTaskId(null);
                }}
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
                    <PanelRight className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold">
                    ここにドロップして右に分割
                  </span>
                  <span className="text-xs text-muted">
                    右ペインだけを差し替えます
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </MobileScrollTargetProvider>
      <AttentionQueueModal />
    </GlobalAttentionProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <TaskSplitProvider>
        <AppShellInner>{children}</AppShellInner>
      </TaskSplitProvider>
    </ShellProvider>
  );
}
