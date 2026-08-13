import { describe, expect, it, beforeEach } from "vitest";
import type { TaskSummary, SessionStatus } from "@/lib/types";
import {
  __clearTaskSummaryCacheForTest,
  prefetchTaskSummaries,
  readCachedTaskSummary,
  rememberTaskSummary,
} from "@/lib/task-summary-cache";

function makeTask(id: string, updatedAt: string, title = `task ${id}`): TaskSummary {
  return {
    id,
    projectId: "p1",
    projectName: "proj",
    title,
    directory: `/w/${id}`,
    isolation: false,
    status: "idle" as SessionStatus,
    sessionId: null,
    executionMode: "session",
    favorite: false,
    branch: null,
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("task-summary-cache", () => {
  beforeEach(() => {
    __clearTaskSummaryCacheForTest();
  });

  it("remember and read round-trips without evicting", () => {
    const task = makeTask("a", "2026-01-01T00:00:00Z");
    rememberTaskSummary(task);
    expect(readCachedTaskSummary("a")).toEqual(task);
    expect(readCachedTaskSummary("a")).toEqual(task);
  });

  it("prefetchTaskSummaries warms only the most recent count", () => {
    const tasks = [
      makeTask("old", "2024-01-01T00:00:00Z"),
      makeTask("mid", "2025-01-01T00:00:00Z"),
      makeTask("new", "2026-01-01T00:00:00Z"),
    ];
    prefetchTaskSummaries(tasks, 2);
    expect(readCachedTaskSummary("new")).not.toBeNull();
    expect(readCachedTaskSummary("mid")).not.toBeNull();
    expect(readCachedTaskSummary("old")).toBeNull();
  });

  it("prefetchTaskSummaries sorts independently of input order", () => {
    const tasks = [
      makeTask("newest", "2026-03-01T00:00:00Z"),
      makeTask("oldest", "2026-01-01T00:00:00Z"),
    ];
    prefetchTaskSummaries(tasks, 1);
    expect(readCachedTaskSummary("newest")).not.toBeNull();
    expect(readCachedTaskSummary("oldest")).toBeNull();
  });
});