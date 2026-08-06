import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  adopt: vi.fn(),
  restoreAll: vi.fn(() => ({ workspaces: 0, sessions: 0 })),
  validate: vi.fn(),
}));

vi.mock("@/lib/project-session-sync", () => ({
  adoptProjectFromManifest: (...args: unknown[]) => h.adopt(...args),
  restoreAllKnownProjects: () => h.restoreAll(),
}));

vi.mock("@/lib/path-validation", () => ({
  resolveValidatedAllowlistPath: (p: string) => h.validate(p),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/projects/restore", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.restoreAll.mockReturnValue({ workspaces: 0, sessions: 0 });
});

describe("POST /api/projects/restore", () => {
  it("rejects rootPath that fails allowlist path validation", async () => {
    h.validate.mockReturnValue({ error: "ドライブルートは許可リストに追加できません" });
    const res = await post({ rootPath: "C:\\" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "ドライブルートは許可リストに追加できません",
    });
    expect(h.adopt).not.toHaveBeenCalled();
  });

  it("adopts only after validation succeeds", async () => {
    h.validate.mockReturnValue({ canonicalPath: "C:\\repo" });
    h.adopt.mockReturnValue({
      project: { id: "p1", name: "repo", root_path: "C:\\repo" },
      restored: { workspaces: 1, sessions: 2 },
    });
    const res = await post({ rootPath: "C:\\repo" });
    expect(res.status).toBe(200);
    expect(h.validate).toHaveBeenCalledWith("C:\\repo");
    expect(h.adopt).toHaveBeenCalledWith("C:\\repo");
    expect(await res.json()).toMatchObject({
      project: { id: "p1", rootPath: "C:\\repo" },
      restored: { workspaces: 1, sessions: 2 },
    });
  });

  it("restores all known projects when rootPath is omitted", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(h.adopt).not.toHaveBeenCalled();
    expect(h.restoreAll).toHaveBeenCalled();
  });
});
