"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

const DESKTOP_SPLIT_QUERY = "(min-width: 1024px)";

type TaskSplitContextValue = {
  desktopSplitEnabled: boolean;
  primaryTaskId: string | null;
  secondaryTaskId: string | null;
  activeTaskId: string | null;
  splitActive: boolean;
  openSplit: (taskId: string) => void;
  closeSplit: () => void;
  activateTask: (taskId: string) => void;
};

const EMPTY_TASK_SPLIT: TaskSplitContextValue = {
  desktopSplitEnabled: false,
  primaryTaskId: null,
  secondaryTaskId: null,
  activeTaskId: null,
  splitActive: false,
  openSplit: () => undefined,
  closeSplit: () => undefined,
  activateTask: () => undefined,
};

const TaskSplitContext = createContext<TaskSplitContextValue>(EMPTY_TASK_SPLIT);

function taskIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith("/task/")) return null;
  const encoded = pathname.slice("/task/".length).split("/")[0];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function TaskSplitProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const primaryTaskId = taskIdFromPathname(pathname);
  const [desktopSplitEnabled, setDesktopSplitEnabled] = useState(false);
  const [secondaryTaskId, setSecondaryTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(primaryTaskId);

  useEffect(() => {
    setSecondaryTaskId((current) =>
      !primaryTaskId || current === primaryTaskId ? null : current,
    );
    setActiveTaskId(primaryTaskId);
  }, [primaryTaskId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_SPLIT_QUERY);
    const apply = () => {
      setDesktopSplitEnabled(media.matches);
      if (!media.matches) {
        setSecondaryTaskId(null);
        setActiveTaskId(primaryTaskId);
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [primaryTaskId]);

  const openSplit = useCallback(
    (taskId: string) => {
      if (
        !desktopSplitEnabled ||
        !primaryTaskId ||
        !taskId ||
        taskId === primaryTaskId
      ) {
        return;
      }
      setSecondaryTaskId(taskId);
      setActiveTaskId(taskId);
    },
    [desktopSplitEnabled, primaryTaskId],
  );

  const closeSplit = useCallback(() => {
    setSecondaryTaskId(null);
    setActiveTaskId(primaryTaskId);
  }, [primaryTaskId]);

  const activateTask = useCallback(
    (taskId: string) => {
      if (taskId === primaryTaskId || taskId === secondaryTaskId) {
        setActiveTaskId(taskId);
      }
    },
    [primaryTaskId, secondaryTaskId],
  );

  const splitActive = Boolean(
    desktopSplitEnabled && primaryTaskId && secondaryTaskId,
  );
  const value = useMemo(
    () => ({
      desktopSplitEnabled,
      primaryTaskId,
      secondaryTaskId,
      activeTaskId,
      splitActive,
      openSplit,
      closeSplit,
      activateTask,
    }),
    [
      desktopSplitEnabled,
      primaryTaskId,
      secondaryTaskId,
      activeTaskId,
      splitActive,
      openSplit,
      closeSplit,
      activateTask,
    ],
  );

  return (
    <TaskSplitContext.Provider value={value}>
      {children}
    </TaskSplitContext.Provider>
  );
}

export function useTaskSplit() {
  return useContext(TaskSplitContext);
}
