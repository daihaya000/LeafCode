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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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
    expect(screen.getByRole("region", { name: "Goalループ" })).toBeTruthy();
  });

  it.each([
    ["queued", "実行中"],
    ["running", "実行中"],
    ["paused", "一時停止"],
    ["verifying_completed", "完了検証中"],
    ["completed", "完了"],
    ["blocked", "ブロック"],
    ["stopped", "停止"],
    ["error", "エラー"],
  ] as const)("renders status label %s -> %s", (status, label) => {
    render(
      <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
    );
    const badge = screen.getByRole("region", { name: "Goalループ" }).querySelector(
      "span[aria-label]",
    );
    expect(badge?.textContent).toContain(label);
  });

  it("shows pause button while running and calls onAction", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    const btn = screen.getByRole("button", { name: "Goalループを一時停止" });
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
    fireEvent.click(screen.getByRole("button", { name: "Goalループを一時停止" }));
    expect(onAction).toHaveBeenCalledWith("pause");
  });

  it("shows resume button when paused", () => {
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "paused" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Goalループを再開" }));
    expect(onAction).toHaveBeenCalledWith("resume");
  });

  it("shows resume button when error", () => {
    render(
      <GoalLoopPanel loop={baseLoop({ status: "error" })} busy={false} onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Goalループを再開" })).toBeTruthy();
  });

  it("does not show stop button when completed/blocked/stopped", () => {
    for (const status of ["completed", "blocked", "stopped"] as const) {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: "Goalループを停止" })).toBeNull();
      cleanup();
    }
  });

  it("confirms before stop and calls onAction when confirmed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Goalループを停止" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      "Goalループを停止しますか？セッションは中断され、進行中の作業は失われます。",
    );
    expect(onAction).toHaveBeenCalledWith("stop");
  });

  it("does not call onAction when stop is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onAction = vi.fn();
    render(
      <GoalLoopPanel loop={baseLoop({ status: "running" })} busy={false} onAction={onAction} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Goalループを停止" }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders progress entries newest-first with role=list", () => {
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
    const list = screen.getByRole("list");
    expect(list).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // newest first
    expect(items[0]!.textContent).toContain("third");
    expect(items[2]!.textContent).toContain("first");
  });

  it("shows toggle when more than 3 entries and expands to show all (max 5)", () => {
    const progress = Array.from({ length: 5 }, (_, i) => ({
      time: `2026-01-01T00:00:0${i + 1}.000Z`,
      status: "progress" as const,
      summary: `entry-${i}`,
    }));
    const loop = baseLoop({ status: "running", progress });
    render(<GoalLoopPanel loop={loop} busy={false} onAction={vi.fn()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const toggle = screen.getByRole("button", { name: /履歴を表示/ });
    fireEvent.click(toggle);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
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
    // click the display button to enter edit mode
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    const input = screen.getByLabelText("最大ターン数") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).toHaveBeenCalledWith(25);
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
    fireEvent.click(screen.getByLabelText("最大ターン数を編集"));
    fireEvent.click(screen.getByLabelText("最大ターン数を保存"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("renders error and blockedReason alerts", () => {
    render(
      <GoalLoopPanel
        loop={baseLoop({ status: "error", error: "爆発した", blockedReason: "理由" })}
        busy={false}
        onAction={vi.fn()}
      />,
    );
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
    expect(screen.getByText("verified")).toBeTruthy();
    expect(screen.getByText("claim")).toBeTruthy();
  });

  it.each(["queued", "running", "paused", "verifying_completed"] as const)(
    "sticks to the top while loop is live (%s)",
    (status) => {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      const region = screen.getByRole("region", { name: "Goalループ" });
      expect(region.getAttribute("data-live")).toBe("true");
      expect(region.className).toContain("sticky");
      expect(region.className).toContain("top-0");
      // 履歴が伸びても画面を占有しないよう高さを制限する
      expect(region.className).toContain("max-h-[45dvh]");
      expect(region.className).toContain("overflow-y-auto");
    },
  );

  it.each(["completed", "blocked", "stopped", "error"] as const)(
    "does not stick when loop is finished (%s)",
    (status) => {
      render(
        <GoalLoopPanel loop={baseLoop({ status })} busy={false} onAction={vi.fn()} />,
      );
      const region = screen.getByRole("region", { name: "Goalループ" });
      expect(region.getAttribute("data-live")).toBeNull();
      expect(region.className).not.toContain("sticky");
    },
  );

  it("keeps the scroll-to-bottom button above the sticky panel", () => {
    render(<GoalLoopPanel loop={baseLoop()} busy={false} onAction={vi.fn()} />);
    // TaskView の「最新のメッセージへ」ボタンは z-50。パネルはその下に潜る必要がある
    const region = screen.getByRole("region", { name: "Goalループ" });
    expect(region.className).toContain("z-10");
  });
});
