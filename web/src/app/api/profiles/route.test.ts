import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
}));

vi.mock("@/lib/profiles/service", () => service);

import { GET, POST } from "./route";

function localGet(url: string) {
  return new NextRequest(url, { headers: { host: "127.0.0.1:3000" } });
}

function localPost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function remoteGet(url: string) {
  return new NextRequest(url, { headers: { host: "192.168.1.50:3000" } });
}

function remotePost(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { host: "192.168.1.50:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/profiles", () => {
  it("rejects non-local requests", async () => {
    const res = await GET(remoteGet("http://lan.example.com/api/profiles"));
    expect(res.status).toBe(403);
  });

  it("returns the profile list", async () => {
    service.listProfiles.mockResolvedValue({
      profiles: [{ id: "a", name: "default", path: "/x", active: true, exists: true }],
      activeId: "a",
      linkState: "link",
      canSwitch: true,
    });

    const res = await GET(localGet("http://127.0.0.1:3000/api/profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profiles).toHaveLength(1);
    expect(body.activeId).toBe("a");
  });

  it("returns 500 on internal error", async () => {
    service.listProfiles.mockRejectedValue(new Error("boom"));
    const res = await GET(localGet("http://127.0.0.1:3000/api/profiles"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/profiles", () => {
  it("rejects non-local requests", async () => {
    const res = await POST(
      remotePost("http://lan.example.com/api/profiles", { name: "x", from: "empty" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when name or from is missing", async () => {
    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles", { name: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 for a synchronously created profile", async () => {
    service.createProfile.mockReturnValue({
      kind: "created",
      profile: { id: "new", name: "work", path: "/p/work", active: false, exists: true },
    });

    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles", { name: "work", from: "empty" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("new");
  });

  it("returns 202 with jobId for an async duplicate", async () => {
    service.createProfile.mockReturnValue({ kind: "job", jobId: "j1" });

    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles", { name: "copy", from: "src-id" }),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toBe("j1");
  });

  it("returns 409 when the service rejects", async () => {
    service.createProfile.mockReturnValue({ status: 409, error: "名前が不正です" });

    const res = await POST(
      localPost("http://127.0.0.1:3000/api/profiles", { name: "", from: "empty" }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("名前が不正です");
  });
});
