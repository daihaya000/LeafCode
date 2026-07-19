import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/allowlist", () => ({
  assertAllowedDirectory: vi.fn(() => ({ ok: true, path: "C:\\repo" })),
}));

import { POST } from "./route";

function post(body: string, contentType = "application/json") {
  return POST(
    new NextRequest(
      "http://localhost/api/opencode/session/session-1/prompt_async?directory=C%3A%5C%5Crepo",
      {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      },
    ),
    { params: Promise.resolve({ path: ["session", "session-1", "prompt_async"] }) },
  );
}

describe("POST /api/opencode/session/:id/prompt_async variant validation", () => {
  it("returns 400 without calling upstream for an invalid variant", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await post(JSON.stringify({ variant: "turbo" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid variant" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("forwards a high variant body to upstream", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const body = JSON.stringify({ model: { modelID: "model-1" }, variant: "high" });

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(await new Response(init?.body).text()).toBe(body);
    fetchMock.mockRestore();
  });

  it("forwards a medium variant body to upstream", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const body = JSON.stringify({
      model: { modelID: "model-1" },
      variant: "medium",
    });

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(await new Response(init?.body).text()).toBe(body);
    fetchMock.mockRestore();
  });
});
