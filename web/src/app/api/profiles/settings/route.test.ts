import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/profiles/settings", () => ({
  readProfileSetupSettings: h.read,
  writeProfileSetupSettings: h.write,
}));

import { GET, PUT } from "./route";

const local = (method: string, body?: unknown) => new Request("http://127.0.0.1:3000/api/profiles/settings", {
  method,
  headers: {
    host: "127.0.0.1:3000",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  h.read.mockReset().mockReturnValue({ browserBridge: true, cursorAcp: true });
  h.write.mockReset().mockImplementation((value) => value);
});

describe("/api/profiles/settings", () => {
  it("returns setup settings", async () => {
    const response = await GET(local("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ browserBridge: true, cursorAcp: true });
  });

  it("saves both setup switches", async () => {
    const response = await PUT(local("PUT", { browserBridge: false, cursorAcp: true }));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith({ browserBridge: false, cursorAcp: true });
  });

  it("rejects incomplete settings", async () => {
    const response = await PUT(local("PUT", { browserBridge: false }));
    expect(response.status).toBe(400);
  });
});
