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

const { GET } = await import("./route");
const { POST } = await import("./extract/route");
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
    const apr = await approvePOST(req(`/api/memory/${created.id}/approve`, {
      method: "POST",
      body: { workspaceId: "ws-a", expectedRevision: 0 },
    }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(apr.status).toBe(200);

    const pat = await PATCH(req(`/api/memory/${created.id}`, {
      method: "PATCH",
      body: { workspaceId: "ws-a", expectedRevision: 1, content: "candidate updated", kind: "fact" },
    }), { params: Promise.resolve({ id: created.id }) });
    expect(pat.status).toBe(200);

    const del = await DELETE(req(`/api/memory/${created.id}?workspace_id=ws-a&expected_revision=2`, { method: "DELETE" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(del.status).toBe(200);
  });

  it("returns 404 for an unknown memory", async () => {
    const res = await PATCH(req("/api/memory/nope", {
      method: "PATCH",
      body: { workspaceId: "ws-a", expectedRevision: 0, content: "x" },
    }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("requires a workspace and rejects an operation scoped to another workspace", async () => {
    const privateMemory = createMemory({
      workspaceId: "ws-a",
      kind: "fact",
      content: "private",
      provenance: "manual",
    });
    expect((await GET(req("/api/memory"))).status).toBe(400);
    expect((await PATCH(req(`/api/memory/${privateMemory.id}`, {
      method: "PATCH",
      body: { workspaceId: "ws-other", expectedRevision: 0, content: "changed" },
    }), { params: Promise.resolve({ id: privateMemory.id }) })).status).toBe(404);
  });

  it("extract endpoint accepts workspace + session", async () => {
    const res = await POST(req("/api/memory/extract", {
      method: "POST",
      body: { workspaceId: "ws-a", sessionId: "ses_1" },
    }));
    expect(res.status).toBe(200);
  });

  it("returns conflict for a stale revision and rejects a missing delete revision", async () => {
    const created = createMemory({
      workspaceId: "ws-a",
      kind: "fact",
      content: "revision one",
      provenance: "manual",
    });
    const first = await PATCH(req(`/api/memory/${created.id}`, {
      method: "PATCH",
      body: { workspaceId: "ws-a", expectedRevision: 0, content: "revision two" },
    }), { params: Promise.resolve({ id: created.id }) });
    expect(first.status).toBe(200);
    const stale = await PATCH(req(`/api/memory/${created.id}`, {
      method: "PATCH",
      body: { workspaceId: "ws-a", expectedRevision: 0, content: "stale" },
    }), { params: Promise.resolve({ id: created.id }) });
    expect(stale.status).toBe(409);
    const missingDeleteRevision = await DELETE(
      req(`/api/memory/${created.id}?workspace_id=ws-a`, { method: "DELETE" }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(missingDeleteRevision.status).toBe(400);
  });

  it("extract endpoint rejects a missing body", async () => {
    const res = await POST(req("/api/memory/extract", { method: "POST", body: {} }));
    expect(res.status).toBe(400);
  });
});
