"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

const DESKTOP_SPLIT_QUERY = "(min-width: 1024px)";

type TaskSplitContextValue = {
  desktopSplitEnabled: boolean;
  splitHostEnabled: boolean;
  primaryTaskId: string | null;
  secondaryTaskId: string | null;
  activeTaskId: string | null;
  splitActive: boolean;
  openSplit: (taskId: string) => void;
  openSplitLeft: (taskId: string) => void;
  closeSplit: () => void;
  activatePrimary: () => void;
  activateTask: (taskId: string) => void;
};

const EMPTY_TASK_SPLIT: TaskSplitContextValue = {
  desktopSplitEnabled: false,
  splitHostEnabled: false,
  primaryTaskId: null,
  secondaryTaskId: null,
  activeTaskId: null,
  splitActive: false,
  openSplit: () => undefined,
  openSplitLeft: () => undefined,
  closeSplit: () => undefined,
  activatePrimary: () => undefined,
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
  const router = useRouter();
  const primaryTaskId = taskIdFromPathname(pathname);
  const splitHostEnabled = pathname === "/" || pathname.startsWith("/task/");
  const [desktopSplitEnabled, setDesktopSplitEnabled] = useState(false);
  const [secondaryTaskId, setSecondaryTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(primaryTaskId);

  useEffect(() => {
    if (!splitHostEnabled) {
      setSecondaryTaskId(null);
      setActiveTaskId(null);
      return;
    }
    setSecondaryTaskId((current) =>
      primaryTaskId && current === primaryTaskId ? null : current,
    );
    setActiveTaskId(primaryTaskId);
  }, [primaryTaskId, splitHostEnabled]);

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
        !splitHostEnabled ||
        !taskId ||
        taskId === primaryTaskId ||
        taskId === secondaryTaskId
      ) {
        return;
      }
      setSecondaryTaskId(taskId);
      setActiveTaskId(taskId);
    },
    [desktopSplitEnabled, primaryTaskId, secondaryTaskId, splitHostEnabled],
  );

  const openSplitLeft = useCallback(
    (taskId: string) => {
      if (
        !desktopSplitEnabled ||
        !splitHostEnabled ||
        !taskId ||
        taskId === primaryTaskId ||
        taskId === secondaryTaskId
      ) {
        return;
      }
      setActiveTaskId(taskId);
      router.push(`/task/${encodeURIComponent(taskId)}`);
    },
    [
      desktopSplitEnabled,
      primaryTaskId,
      router,
      secondaryTaskId,
      splitHostEnabled,
    ],
  );

  const closeSplit = useCallback(() => {
    setSecondaryTaskId(null);
    setActiveTaskId(primaryTaskId);
  }, [primaryTaskId]);

  const activatePrimary = useCallback(() => {
    if (splitHostEnabled) setActiveTaskId(primaryTaskId);
  }, [primaryTaskId, splitHostEnabled]);

  const activateTask = useCallback(
    (taskId: string) => {
      if (taskId === primaryTaskId || taskId === secondaryTaskId) {
        setActiveTaskId(taskId);
      }
    },
    [primaryTaskId, secondaryTaskId],
  );

  const splitActive = Boolean(
    desktopSplitEnabled &&
      splitHostEnabled &&
      secondaryTaskId,
  );
  const value = useMemo(
    () => ({
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
    }),
    [
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
