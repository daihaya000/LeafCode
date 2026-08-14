import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ocServer: vi.fn(),
  modelPricing: {} as Record<string, { input: number; output: number; cachedInput?: number; cacheWrite?: number }>,
}));

vi.mock("./oc-server", async () => {
  const actual = await vi.importActual<typeof import("./oc-server")>("./oc-server");
  return { ...actual, ocServer: h.ocServer };
});

vi.mock("./provider-model-state", () => ({
  readProviderModelState: () => ({ modelPricing: h.modelPricing }),
}));

import {
  __clearSessionEstimateCacheForTest,
  estimateSessionCost,
  estimateSessionCostWithCache,
  exactMessageCost,
  hasPositiveTokenUsage,
  sessionUsageFingerprint,
} from "./task-cost";
import type { MessageWithParts } from "./types";

function tokens(input = 1000, output = 500, reasoning = 0): MessageInfo["tokens"] {
  return { input, output, reasoning, ...(reasoning > 0 ? {} : {}) };
}

beforeEach(() => {
  h.ocServer.mockReset();
  h.modelPricing = {
    "openai::gpt-4o": { input: 5, output: 15 },
  };
  __clearSessionEstimateCacheForTest();
});

describe("hasPositiveTokenUsage", () => {
  it("is false for undefined and all-zero usage", () => {
    expect(hasPositiveTokenUsage(undefined)).toBe(false);
    expect(hasPositiveTokenUsage({ input: 0, output: 0, reasoning: 0 })).toBe(false);
  });

  it("is true when any bucket is positive", () => {
    expect(hasPositiveTokenUsage({ input: 1, output: 0, reasoning: 0 })).toBe(true);
    expect(
      hasPositiveTokenUsage({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 10, write: 0 },
      }),
    ).toBe(true);
  });
});

describe("estimateSessionCost", () => {
  it("returns null without tokens or model ids", () => {
    expect(estimateSessionCost({})).toBeNull();
    expect(estimateSessionCost({ tokens: tokens() })).toBeNull();
  });

  it("estimates cost from tokens and pricing", () => {
    const cost = estimateSessionCost({
      tokens: { input: 1_000_000, output: 1_000_000, reasoning: 0 },
      model: { providerID: "openai", id: "gpt-4o" },
    });
    expect(cost).toBeCloseTo(20);
  });
});

describe("sessionUsageFingerprint", () => {
  it("returns null for unusable sessions", () => {
    expect(sessionUsageFingerprint({})).toBeNull();
  });

  it("is stable for the same model and tokens", () => {
    const a = sessionUsageFingerprint({
      tokens: tokens(100, 50),
      model: { providerID: "openai", id: "gpt-4o" },
    });
    const b = sessionUsageFingerprint({
      tokens: tokens(100, 50),
      model: { providerID: "openai", id: "gpt-4o" },
    });
    expect(a).toBe(b);
  });
});

describe("exactMessageCost", () => {
  function msg(overrides: Partial<MessageInfo> = {}): MessageWithParts {
    return {
      info: {
        role: "assistant",
        id: "m1",
        time: { created: 0, completed: 1 },
        ...overrides,
      },
      parts: [],
    } as MessageWithParts;
  }

  it("returns null for no assistant messages", () => {
    expect(exactMessageCost([])).toBeNull();
  });

  it("sums reported costs", () => {
    const cost = exactMessageCost([
      msg({ cost: 1.5 }),
      msg({ cost: 2.5 }),
    ]);
    expect(cost).toBeCloseTo(4);
  });

  it("estimates unknown models via pricing when tokens are present", () => {
    const cost = exactMessageCost([
      msg({
        providerID: "openai",
        modelID: "gpt-4o",
        tokens: { input: 1_000_000, output: 0, reasoning: 0 },
      }),
    ]);
    expect(cost).toBeCloseTo(5);
  });

  it("returns null when a token-bearing message has no pricing", () => {
    const cost = exactMessageCost([
      msg({
        providerID: "unknown",
        modelID: "model-x",
        tokens: { input: 1000, output: 0, reasoning: 0 },
      }),
    ]);
    expect(cost).toBeNull();
  });
});

describe("estimateSessionCostWithCache", () => {
  it("falls back to the aggregate when the transcript fetch fails", async () => {
    h.ocServer.mockRejectedValue(new Error("down"));
    const cost = await estimateSessionCostWithCache("/ws", {
      id: "s1",
      tokens: { input: 1_000_000, output: 1_000_000, reasoning: 0 },
      model: { providerID: "openai", id: "gpt-4o" },
    });
    expect(cost).toBeCloseTo(20);
  });

  it("uses the exact message cost when the transcript is available", async () => {
    h.ocServer.mockResolvedValue([
      {
        info: { role: "assistant", id: "a1", cost: 3, time: { created: 0 } },
        parts: [],
      },
    ]);
    const cost = await estimateSessionCostWithCache("/ws", {
      id: "s1",
      tokens: { input: 1_000_000, output: 0, reasoning: 0 },
      model: { providerID: "openai", id: "gpt-4o" },
    });
    expect(cost).toBeCloseTo(3);
    expect(h.ocServer).toHaveBeenCalledTimes(1);
  });

  it("serves the second call from cache without refetching", async () => {
    h.ocServer.mockResolvedValue([]);
    const session = {
      id: "s1",
      tokens: { input: 1000, output: 500, reasoning: 0 },
      model: { providerID: "openai", id: "gpt-4o" },
    };
    await estimateSessionCostWithCache("/ws", session);
    await estimateSessionCostWithCache("/ws", session);
    expect(h.ocServer).toHaveBeenCalledTimes(1);
  });
});
