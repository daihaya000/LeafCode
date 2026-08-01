import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalLoopDto } from "@/lib/goal-loop";
import { GoalLoopPanel } from "./GoalLoopPanel";

function baseLoop(overrides: Partial<GoalLoopDto> = {}): GoalLoopDto {
  return {
    id: "loop-1",
    workspaceId: "ws-1",
    sessionId: "ses-1",
    status: "running",
    goal: "テストを通す",
    acceptance: [],
    maxTurns: 10,
    turnCount: 3,
    lastMessageId: null,
    lastPromptAt: null,
    agent: null,
    providerID: null,
    modelID: null,
    variant: null,
    progress: [],
    summary: "",
    evidence: "",
    blockedReason: "",
    error: "",
    revision: 0,
    turnKind: "goal",
    pauseReason: "",
    rejectedClaims: 0,
    pauseRequested: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expandGoalLoopDetails() {
  fireEvent.click(screen.getByRole("button", { name: "ループの詳細を展開" }));
}

describe("GoalLoopPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders nothing when loop is null", () => {
    const { container } = render(
      <GoalLoopPanel loop={null} busy={false} onAction={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders region with aria-label", () => {
    render(<GoalLoopPanel loop={baseLoop()} busy={false} onAction={vi.fn()} />);
    expect(screen.getByRole("region", { name: "ループ" })).toBeTruthy();
  });

  it("renders acceptance criteria when present", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ acceptance: ["tests pass", "lint clean"] })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("tests pass")).toBeTruthy();
    expect(screen.getByText("lint clean")).toBeTruthy();
  });

  it("hides acceptance label when no criteria are set", () => {
    render(
      <GoalLoopPanel loop={baseLoop({ acceptance: [] })} busy={false} onAction={vi.fn()} />,
    );
    expect(screen.queryByText("承認条件:")).toBeNull();
  });

  it("starts compact and reveals details only when expanded", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({
          progress: [
            {
              time: "2026-01-01T00:00:00.000Z",
              status: "progress",
              summary: "現在の作業",
            },
          ],
        })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("button", { name: "ループの詳細を展開" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("現在の作業")).toBeNull();
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "ループの詳細を折りたたむ" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("現在の作業")).toBeTruthy();
  });

  it("keeps a completed loop compact with a short result summary", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "completed", summary: "承認カードを統合しました" })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("完了: 承認カードを統合しました")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it.each([
    ["queued", "実行中"],
    ["running", "実行中"],
    ["paused", "一時停止"],
    ["verifying_completed", "完了検証中"],
    ["completed", "完了"],
    ["blocked", "ブロック"],
    ["stopped", "停止"],
  ] as const)("renders status label %s -> %s", (status, label) => {
    render(
      <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
    );
    const badge = screen.getByRole("region", { name: "ループ" }).querySelector(
      "span[aria-label]",
    );
    expect(badge?.textContent).toContain(label);
  });

  it("shows pause button while running and calls onAction", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    const btn = screen.getByRole("button", { name: "ループを一時停止" });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith("pause");
  });

  it("allows pausing while completion is being verified", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "verifying_completed" })}
        busy={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ループを一時停止" }));
    expect(onAction).toHaveBeenCalledWith("pause");
  });

  it("shows resume button when paused", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "paused" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ループを再開" }));
    expect(onAction).toHaveBeenCalledWith("resume");
  });

  it("shows resume button when paused by a scheduler error", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", pauseReason: "scheduler_error", error: "爆発した" })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "ループを再開" })).toBeTruthy();
  });

  it("explains what resuming will do for each pause reason", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({
          status: "paused",
          pauseReason: "unknown_delivery",
          error: "送信の送達を確認できませんでした。",
        })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/重複送信は行いません/)).toBeTruthy();
    cleanup();

    // A verification rejection resumes very differently from a delivery-unknown
    // pause, so the hint must not be the same text.
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", pauseReason: "verification_rejected" })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/却下回数をリセット/)).toBeTruthy();
  });

  it("omits the pause hint while the loop is running", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "running", pauseReason: "user" })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText(/再開すると次のターンを送信します/)).toBeNull();
  });

  it("says the turn budget counts goal turns only", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "verifying_completed", turnCount: 3 })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "ループ状態: 完了検証中、Goalターン 3 / 10（完了検証ターンは含みません）",
      ),
    ).toBeTruthy();
  });

  it("does not show stop button when completed/blocked/stopped", () => {
    for (const status of ["completed", "blocked", "stopped"] as const) {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: "ループを停止" })).toBeNull();
      cleanup();
    }
  });

  it("confirms before stop and calls onAction when confirmed", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ループを停止" }));
    fireEvent.click(screen.getByRole("dialog").querySelector("button")!);
    expect(onAction).toHaveBeenCalledWith("stop");
  });

  it("does not call onAction when stop is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ループを停止" }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("focuses the stop confirmation and closes it with Escape", () => {
    render(<GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={vi.fn()} />);
    const stop = screen.getAllByRole("button").find((button) => button.getAttribute("aria-label") === "ループを停止") as HTMLElement;
    stop.focus();
    fireEvent.click(stop);

    const dialog = screen.getByRole("dialog");
    const confirm = dialog.querySelector("button") as HTMLElement;
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(stop);
  });

  it("renders only the current progress entry", () => {
    const loop = baseLoop({
      status: "running",
      progress: [
        {
          time: "2026-01-01T00:00:01.000Z",
          status: "progress",
          summary: "first",
          next: "n1",
        },
        {
          time: "2026-01-01T00:00:02.000Z",
          status: "progress",
          summary: "second",
        },
        {
          time: "2026-01-01T00:00:03.000Z",
          status: "completed",
          summary: "third",
        },
      ],
    });
    render(<GoalLoopPanel loop={loop} busy={false} onAction={vi.fn()} />);
    expandGoalLoopDetails();
    const list = screen.getByRole("list");
    expect(list).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("third");
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.queryByText("second")).toBeNull();
  });

  it("does not render history controls when prior entries exist", () => {
    const progress = Array.from({ length: 5 }, (_, i) => ({
      time: `2026-01-01T00:00:0${i + 1}.000Z`,
      status: "progress" as const,
      summary: `entry-${i}`,
    }));
    const loop = baseLoop({ status: "running", progress });
    render(<GoalLoopPanel loop={loop} busy={false} onAction={vi.fn()} />);
    expandGoalLoopDetails();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /履歴を/ })).toBeNull();
    expect(screen.getByText("entry-4")).toBeTruthy();
  });

  it("does not render progress list when empty", () => {
    render(<GoalLoopPanel loop={baseLoop()} busy={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows maxTurns edit UI only when paused and onUpdateMaxTurns provided", () => {
    const onUpdate = vi.fn();
    // running: no edit UI
    const { rerender } = render(
      <GoalLoopPanel
        loop={baseLoop({ status: "running" })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expect(screen.queryByLabelText("最大ターン数を編集")).toBeNull();

    // paused: edit UI present
    rerender(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", maxTurns: 10 })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expandGoalLoopDetails();
    expect(screen.getByLabelText("最大ターン数を編集")).toBeTruthy();
  });

  it("commits edited maxTurns via onUpdateMaxTurns", () => {
    const onUpdate = vi.fn();
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", maxTurns: 10 })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expandGoalLoopDetails();
    // click the display button to enter edit mode
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    const input = screen.getByLabelText("最大ターン数") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).toHaveBeenCalledWith(25);
  });

  it("allows replacing 1 with a multi-digit maxTurns value", () => {
    const onUpdate = vi.fn();
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", maxTurns: 1 })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expandGoalLoopDetails();
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    const input = screen.getByLabelText("最大ターン数") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "20" } });
    expect(input.value).toBe("20");
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).toHaveBeenCalledWith(20);
  });

  it("clamps edited maxTurns to 1..100", () => {
    const onUpdate = vi.fn();
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", maxTurns: 10 })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expandGoalLoopDetails();
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    const input = screen.getByLabelText("最大ターン数") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).toHaveBeenCalledWith(100);
  });

  it("does not call onUpdateMaxTurns when value unchanged", () => {
    const onUpdate = vi.fn();
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "paused", maxTurns: 10 })}
        busy={false}
        onAction={vi.fn()}
        onUpdateMaxTurns={onUpdate}
      />,
    );
    expandGoalLoopDetails();
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("renders error and blockedReason alerts", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({
          status: "paused",
          pauseReason: "scheduler_error",
          error: "爆発した",
          blockedReason: "理由",
        })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expandGoalLoopDetails();
    expect(screen.getByText("爆発した")).toBeTruthy();
    expect(screen.getByText("理由")).toBeTruthy();
  });

  it("renders verified_completed history entry with a check icon", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({
          status: "completed",
          progress: [
            {
              time: "2026-01-01T00:00:00.000Z",
              status: "completed",
              summary: "claim",
              evidence: "evidence",
            },
            {
              time: "2026-01-01T00:01:00.000Z",
              status: "verified_completed",
              summary: "verified",
              evidence: "checks passed",
            },
          ],
        })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expandGoalLoopDetails();
    expect(screen.getByText("verified")).toBeTruthy();
    expect(screen.queryByText("claim")).toBeNull();
  });

  it("renders verifying_completed history entry with a check icon", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({
          progress: [
            {
              time: "2026-01-01T00:00:00.000Z",
              status: "verifying_completed",
              summary: "completion claim",
            },
          ],
        })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
    expandGoalLoopDetails();
    expect(screen.getByTestId("goal-loop-progress-check")).toBeTruthy();
  });

  it.each(["queued", "running", "paused", "verifying_completed"] as const)(
    "sticks to the top while loop is live (%s)",
    (status) => {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      const region = screen.getByRole("region", { name: "ループ" });
      expect(region.getAttribute("data-live")).toBe("true");
      expect(region.className).toContain("sticky");
      expect(region.className).toContain("top-0");
      expect(region.className).not.toContain("max-h-[45dvh]");
      expect(region.className).not.toContain("overflow-y-auto");
      expandGoalLoopDetails();
      expect(region.className).toContain("max-h-[45dvh]");
      expect(region.className).toContain("overflow-y-auto");
    },
  );

  it.each(["completed", "blocked", "stopped"] as const)(
    "does not stick when loop is finished (%s)",
    (status) => {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      const region = screen.getByRole("region", { name: "ループ" });
      expect(region.getAttribute("data-live")).toBeNull();
      expect(region.className).not.toContain("sticky");
    },
  );

  it("keeps the scroll-to-bottom button above the sticky panel", () => {
    render(<GoalLoopPanel loop={baseLoop()} busy={false} onAction={vi.fn()} />);
    // TaskView の「最新のメッセージへ」ボタンは z-50。パネルはその下に潜る必要がある
    const region = screen.getByRole("region", { name: "ループ" });
    expect(region.className).toContain("z-10");
  });

  it("does not crash when acceptance is missing (legacy/mock payload)", () => {
    // The DTO types `acceptance` as a required string[], but a stale API
    // response, a partial mock, or a pre-migration row can omit it. Reading
    // `.length` on undefined used to throw and blank the whole panel.
    const loop = baseLoop() as GoalLoopDto & { acceptance?: undefined };
    delete (loop as { acceptance?: unknown }).acceptance;
    expect(() =>
      render(<GoalLoopPanel loop={loop} busy={false} onAction={vi.fn()} />),
    ).not.toThrow();
    expect(screen.queryByText("承認条件:")).toBeNull();
  });
});
