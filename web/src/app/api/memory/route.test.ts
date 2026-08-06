import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const testDataDir = mkdtempSync(path.join(os.tmpdir(), "opencode-webui-mem-api-"));
const previousAppData = process.env.APPDATA;
const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(testDataDir);
process.env.APPDATA = testDataDir;

const { getDb, upsertProject, createWorkspace } = await import("@/lib/db");
const { createMemory } = await import("@/lib/memory");

vi.mock("@/lib/memory-extract", () => ({
  runMemoryExtraction: vi.fn(async () => ({ created: 0, skipped: 0, errors: [] })),
}));
vi.mock("@/lib/api-guard", () => ({
  requireAuthorized: vi.fn(async () => null),
}));

const { GET, POST } = await import("./route");
const { PATCH, DELETE } = await import("./[id]/route");
const { POST: approvePOST } = await import("./[id]/approve/route");

function ensureWorkspace(id: string) {
  const project = upsertProject({ name: `proj-${id}`, rootPath: path.join(testDataDir, id) });
  createWorkspace({
    id,
    projectId: project.id,
    displayName: `Workspace ${id}`,
    absolutePath: path.join(testDataDir, id),
    isolation: "current_folder",
  });
}

function req(pathname: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: init?.method ?? "GET",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

afterAll(() => {
  getDb().close();
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  homedirSpy.mockRestore();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("memory API", () => {
  beforeAll(() => {
    ensureWorkspace("ws-a");
  });

  it("lists memories with filters", async () => {
    createMemory({
      workspaceId: "ws-a",
      kind: "fact",
      content: "api test",
      provenance: "manual",
      approved: true,
    });
    const res = await GET(req("/api/memory?workspace_id=ws-a&approved=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memories: unknown[] };
    expect(body.memories).toHaveLength(1);
  });

  it("approves, patches, deletes a memory", async () => {
    const created = createMemory({
      workspaceId: "ws-a",
      kind: "lesson",
      content: "candidate",
      provenance: "auto-extract",
      approved: false,
    });
    const apr = await approvePOST(req(`/api/memory/${created.id}/approve`, { method: "POST" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(apr.status).toBe(200);

    const pat = await PATCH(req(`/api/memory/${created.id}`, {
      method: "PATCH",
      body: { content: "candidate updated", kind: "fact" },
    }), { params: Promise.resolve({ id: created.id }) });
    expect(pat.status).toBe(200);

    const del = await DELETE(req(`/api/memory/${created.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(del.status).toBe(200);
  });

  it("returns 404 for an unknown memory", async () => {
    const res = await PATCH(req("/api/memory/nope", { method: "PATCH", body: { content: "x" } }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("extract endpoint accepts workspace + session", async () => {
    const res = await POST(req("/api/memory/extract", {
      method: "POST",
      body: { workspaceId: "ws-a", sessionId: "ses_1" },
    }));
    expect(res.status).toBe(200);
  });

  it("extract endpoint rejects a missing body", async () => {
    const res = await POST(req("/api/memory/extract", { method: "POST", body: {} }));
    expect(res.status).toBe(400);
  });
});