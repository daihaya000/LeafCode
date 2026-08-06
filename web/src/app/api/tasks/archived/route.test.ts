import { beforeEach, describe, expect, it, vi } from "vitest";
const { listArchivedTasksMock } = vi.hoisted(() => ({
  listArchivedTasksMock: vi.fn(),
}));

vi.mock("@/lib/task-service", () => ({
  listArchivedTasks: listArchivedTasksMock,
}));

import { GET } from "./route";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api", {
    headers: { host: "127.0.0.1:3000" },
  });
}


beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tasks/archived", () => {
  it("returns archived tasks", async () => {
    const fakeTasks = [
      {
        id: "ws1",
        projectId: "prj1",
        projectName: "Repo",
        title: "Archived task",
        directory: "/repo",
        isolation: "current_folder",
        status: "merged",
        sessionId: null,
        branch: "main",
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T01:00:00Z",
      },
    ];
    listArchivedTasksMock.mockResolvedValue(fakeTasks);

    const response = await GET(localReq());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tasks: fakeTasks });
  });

  it("returns empty array when no archived tasks exist", async () => {
    listArchivedTasksMock.mockResolvedValue([]);

    const response = await GET(localReq());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tasks: [] });
  });
});
