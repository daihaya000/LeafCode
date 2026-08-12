import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTaskCostMock } = vi.hoisted(() => ({
  getTaskCostMock: vi.fn(),
}));

vi.mock("@/lib/task-service", () => ({
  getTaskCost: getTaskCostMock,
}));

import { OcError } from "@/lib/oc-server";
import { GET } from "./route";

/** Loopback request so the shared API guard authorizes these handler calls. */
function localReq() {
  return new Request("http://127.0.0.1:3000/api/tasks/ws1/cost", {
    headers: { host: "127.0.0.1:3000" },
  }) as never;
}

function ctx(id = "ws1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tasks/[id]/cost", () => {
  it("returns the live cost", async () => {
    getTaskCostMock.mockResolvedValue(1.25);
    const response = await GET(localReq(), ctx());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cost: 1.25 });
  });

  it("returns null cost when the engine is unavailable", async () => {
    getTaskCostMock.mockResolvedValue(undefined);
    const response = await GET(localReq(), ctx());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cost: null });
  });

  it("swallows OcError instead of crashing the route", async () => {
    getTaskCostMock.mockRejectedValue(
      new OcError(
        "OpenCode engine が2秒でタイムアウトしました (/session/ses_1)",
        408,
      ),
    );
    const response = await GET(localReq(), ctx());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cost: null });
  });
});
