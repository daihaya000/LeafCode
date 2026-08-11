import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getDb: vi.fn(),
  listWorkspacesJoined: vi.fn(),
  ocServer: vi.fn(),
  readProviderModelState: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: h.getDb,
  listWorkspacesJoined: h.listWorkspacesJoined,
}));
vi.mock("@/lib/oc-server", () => ({ ocServer: h.ocServer }));
vi.mock("@/lib/provider-model-state", () => ({
  readProviderModelState: h.readProviderModelState,
}));
vi.mock("@/lib/api-guard", () => ({
  requireAuthorized: vi.fn(async () => null),
}));

import { GET } from "./route";

const assistantMessage = {
  info: {
    id: "msg-1",
    role: "assistant" as const,
    providerID: "paid",
    modelID: "model",
    cost: 0,
    tokens: { input: 0, output: 100, reasoning: 0 },
  },
  parts: [],
};

function localReq() {
  return new Request("http://127.0.0.1:3000/api/analytics/model-ranking", {
    headers: { host: "127.0.0.1:3000" },
  });
}

beforeEach(() => {
  h.getDb.mockReturnValue({
    prepare: () => ({
      all: () => [{ workspace_id: "ws-1", opencode_session_id: "ses-1" }],
    }),
  });
  h.listWorkspacesJoined.mockReturnValue([
    { id: "ws-1", absolute_path: "C:\\repo" },
  ]);
  h.ocServer.mockResolvedValue([assistantMessage]);
  h.readProviderModelState.mockReturnValue({
    modelPricing: { "paid::model": { input: 0, output: 10 } },
  });
});

describe("GET /api/analytics/model-ranking", () => {
  it("uses saved model pricing when the engine reports zero cost", async () => {
    const response = await GET(localReq());
    const body = (await response.json()) as {
      rankings: { cost: number; tokensPerDollar: number | null }[];
    };

    expect(response.status).toBe(200);
    expect(body.rankings[0].cost).toBeCloseTo(0.001, 12);
    expect(body.rankings[0].tokensPerDollar).toBeCloseTo(100_000, 8);
  });
});
