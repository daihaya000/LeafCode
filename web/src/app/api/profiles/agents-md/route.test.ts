import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/profiles/agents-sync-engine", () => ({
  readMasterAgents: h.read,
  writeMasterAgents: h.write,
}));

import { GET, PATCH } from "./route";

function request(method: string, body?: unknown, rawBody?: string) {
  return new NextRequest("http://127.0.0.1:3000/api/profiles/agents-md", {
    method,
    headers: {
      host: "127.0.0.1:3000",
      ...(body !== undefined || rawBody !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockReturnValue({
    path: "C:/home/.config/opencode/AGENTS.md",
    exists: true,
    content: "instructions",
  });
  h.write.mockReturnValue({ path: "C:/home/.config/opencode/AGENTS.md" });
});

describe("/api/profiles/agents-md", () => {
  it("reads the active profile AGENTS.md", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "C:/home/.config/opencode/AGENTS.md",
      exists: true,
      content: "instructions",
    });
  });

  it("writes valid content", async () => {
    const response = await PATCH(request("PATCH", { content: "updated" }));
    expect(response.status).toBe(200);
    expect(h.write).toHaveBeenCalledWith("updated");
  });

  it("rejects JSON null instead of throwing", async () => {
    const response = await PATCH(request("PATCH", null));
    expect(response.status).toBe(400);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("rejects content over 2 MiB", async () => {
    const response = await PATCH(request("PATCH", { content: "x".repeat(2 * 1024 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(h.write).not.toHaveBeenCalled();
  });
});
