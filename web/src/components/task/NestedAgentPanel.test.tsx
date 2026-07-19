import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NestedAgentPanel } from "./NestedAgentPanel";

const { ocJson } = vi.hoisted(() => ({ ocJson: vi.fn() }));

vi.mock("@/lib/client", () => ({
  ocJson,
}));

vi.mock("./PartView", () => ({
  PartView: () => null,
}));

function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
}

const CHILD_ID = "child-session-1";
const PARENT_ID = "parent-session";

function mockChildApis() {
  ocJson.mockImplementation(async (path: string) => {
    if (path === "/session/status") {
      return { [CHILD_ID]: { type: "busy" } };
    }
    if (path === `/session/${PARENT_ID}/children`) {
      return [{ id: CHILD_ID, title: "子エージェント", parentID: PARENT_ID }];
    }
    if (path === `/session/${CHILD_ID}/message`) {
      return [
        {
          info: {
            id: "m1",
            role: "assistant",
            agent: "explore",
            providerID: "anthropic",
            modelID: "claude-sonnet-5",
            cost: 0.0312,
            time: { created: 1 },
          },
          parts: [{ id: "p1", type: "text", text: "作業中テキスト" }],
        },
      ];
    }
    return null;
  });
}

describe("NestedAgentPanel", () => {
  beforeEach(() => {
    setVisible(true);
    ocJson.mockReset();
    mockChildApis();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const hint = {
    callID: "call-1",
    metadata: { sessionID: CHILD_ID },
    input: { description: "調査" },
    siblingTaskCallIds: ["call-1"],
  };

  it("uses the shared model and cost metadata for child messages", async () => {
    render(
      <NestedAgentPanel
        directory="/repo"
        parentSessionId={PARENT_ID}
        active
        matchHint={hint}
        modelLabels={{ "anthropic::claude-sonnet-5": "Claude Sonnet 5" }}
        costPrefs={{ currency: "USD", rateMode: "manual", usdJpyRate: 150 }}
      />,
    );
    expect(await screen.findByText("子エージェント")).toBeTruthy();
    expect(await screen.findByText("Claude Sonnet 5")).toBeTruthy();
    expect(screen.getByText("cost $0.0312")).toBeTruthy();
    expect(screen.queryByText("explore")).toBeNull();
    expect(screen.getByText("子エージェント")).toBeTruthy();
  });

  it("polls child messages while active and visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <NestedAgentPanel
        directory="/repo"
        parentSessionId={PARENT_ID}
        active
        matchHint={hint}
      />,
    );

    await screen.findByText("子エージェント");
    const afterMount = ocJson.mock.calls.length;
    expect(afterMount).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(ocJson.mock.calls.length).toBeGreaterThan(afterMount);
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisible(false);
    render(
      <NestedAgentPanel
        directory="/repo"
        parentSessionId={PARENT_ID}
        active
        matchHint={hint}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const afterMount = ocJson.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(ocJson).toHaveBeenCalledTimes(afterMount);
  });

  it("refetches immediately when the tab becomes visible again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setVisible(false);
    render(
      <NestedAgentPanel
        directory="/repo"
        parentSessionId={PARENT_ID}
        active
        matchHint={hint}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const afterHiddenMount = ocJson.mock.calls.length;

    setVisible(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(ocJson.mock.calls.length).toBeGreaterThan(afterHiddenMount);
    await screen.findByText("子エージェント");
  });
});
