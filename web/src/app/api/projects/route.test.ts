import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

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

import { upsertProject } from "@/lib/db";
import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects path validation", () => {
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertProject).mockReturnValue({
      id: "project-1",
      name: "tmp",
      root_path: "",
      favorite: 0,
      last_opened_at: null,
      created_at: "2026-01-01",
    } as never);
    tempRoot = fs.mkdtempSync(path.join(tmpdir(), "projects-route-"));
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("rejects a non-existent path with 400", async () => {
    const res = await POST(req({ rootPath: "C:\\nonexistent-xyz-123" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects C:\\Windows with 400", async () => {
    const res = await POST(req({ rootPath: "C:\\Windows" }) as never);
    expect(res.status).toBe(400);
    expect(upsertProject).not.toHaveBeenCalled();
  });

  it.each([
    "C:\\",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
  ])("rejects protected path %s with 400", async (rootPath) => {
    const res = await POST(req({ rootPath }) as never);
    expect(res.status).toBe(400);
    expect(upsertProject).not.toHaveBeenCalled();
  });

  it("rejects a file and the user profile root without writing to the DB", async () => {
    const fileResponse = await POST(req({ rootPath: __filename }) as never);
    const profileResponse = await POST(
      req({ rootPath: process.env.USERPROFILE }) as never,
    );

    expect(fileResponse.status).toBe(400);
    expect(profileResponse.status).toBe(400);
    expect(upsertProject).not.toHaveBeenCalled();
  });

  it("accepts a valid temporary directory and stores its canonical path", async () => {
    const res = await POST(req({ rootPath: tempRoot }) as never);
    expect(res.status).toBe(200);
    expect(upsertProject).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: fs.realpathSync.native(tempRoot) }),
    );
  });

  it("stores the canonical target of a symlink to an allowed directory", async () => {
    const target = path.join(tempRoot, "allowed-target");
    const link = path.join(tempRoot, "allowed-link");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, "junction");

    const res = await POST(req({ rootPath: link }) as never);
    expect(res.status).toBe(200);
    expect(upsertProject).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: fs.realpathSync.native(target) }),
    );
  });

  it("rejects a protected directory reached through an intermediate junction", async () => {
    const link = path.join(tempRoot, "windows-link");
    fs.symlinkSync(process.env.SystemRoot ?? "C:\\Windows", link, "junction");

    const res = await POST(req({ rootPath: path.join(link, "System32") }) as never);
    expect(res.status).toBe(400);
    expect(upsertProject).not.toHaveBeenCalled();
  });
});
