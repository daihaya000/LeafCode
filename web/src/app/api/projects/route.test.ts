import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  listProjects: vi.fn(() => []),
  upsertProject: vi.fn(),
}));
vi.mock("@/lib/allowlist", () => ({
  realPathOrResolved: (p: string) => p,
}));
vi.mock("@/lib/project-session-sync", () => ({
  restoreProjectFromManifest: vi.fn(() => ({ workspaces: 0, sessions: 0 })),
}));
vi.mock("@/lib/workspace-service", () => ({
  ServiceError: class ServiceError extends Error {
    status = 500;
  },
  destroyProject: vi.fn(),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects path validation", () => {
  it("rejects a non-existent path with 400", async () => {
    const res = await POST(req({ rootPath: "C:\\nonexistent-xyz-123" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Windows with 400", async () => {
    const res = await POST(req({ rootPath: "C:\\Windows" }) as never);
    expect(res.status).toBe(400);
  });
});
