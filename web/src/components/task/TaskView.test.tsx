import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSummary } from "@/lib/types";
import { TaskView } from "./TaskView";

const { getJson, useSessionStream } = vi.hoisted(() => ({
  getJson: vi.fn(),
  useSessionStream: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  ocJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/currency", () => ({
  formatCost: (cost: number) => `$${cost.toFixed(4)}`,
  formatCostValue: (cost: number) => `$${cost.toFixed(4)}`,
  useCostDisplayPrefs: () => ({ currency: "USD", usdJpyRate: 150 }),
}));

vi.mock("@/lib/useSessionStream", () => ({ useSessionStream }));

vi.mock("@/components/shell/ShellContext", () => ({
  useShellExtras: () => ({ setExtras: vi.fn() }),
  useShellSetActiveScope: () => vi.fn(),
}));

vi.mock("@/components/AccessModeSelect", () => ({ AccessModeSelect: () => null }));
vi.mock("@/components/IntelligenceSelect", () => ({ IntelligenceSelect: () => null }));
vi.mock("@/components/StatusBadge", () => ({ StatusBadge: () => null }));
vi.mock("./DiffPane", () => ({ DiffPane: () => null }));
vi.mock("./FileTreePanel", () => ({ FileTreePanel: () => null }));
vi.mock("./GraphPanel", () => ({ GraphPanel: () => null }));
vi.mock("./PartView", () => ({ PartView: () => null }));
vi.mock("./PlanDocumentCard", () => ({ PlanDocumentCard: () => null }));
vi.mock("./PermissionCard", () => ({ PermissionCard: () => null }));
vi.mock("./PtyPanel", () => ({ PtyPanel: () => null }));
vi.mock("./QuestionCard", () => ({ QuestionCard: () => null }));
vi.mock("./SessionActions", () => ({
  SessionActions: () => null,
  MessageRevertButton: () => null,
}));
vi.mock("./SessionSwitcher", () => ({ SessionSwitcher: () => null }));

let taskStatus: TaskSummary["status"];
let taskResponseCosts: number[];

function task(cost: number): TaskSummary {
  return {
    id: "ws1",
    projectId: "prj1",
    projectName: "Repo",
    title: "Task title",
    directory: "/repo",
    isolation: "current_folder",
    status: taskStatus,
    sessionId: "sess1",
    branch: "main",
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    cost,
    createdAt: "2026-07-18T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
  };
}

function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
}

async function flushTaskLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TaskView", () => {
  beforeEach(() => {
    taskStatus = "working";
    taskResponseCosts = [0.1, 0.2];
    setVisible(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSessionStream.mockReturnValue({
      messages: [],
      visibleMessages: [],
      status: { type: "busy" },
      permissions: [],
      questions: [],
      todos: [],
      revert: null,
      connection: "live",
      sessionError: null,
      loaded: true,
      abort: vi.fn(),
      refreshTodos: vi.fn(),
      rejectQuestion: vi.fn(),
      replyPermission: vi.fn(),
      replyQuestion: vi.fn(),
      resync: vi.fn(),
      sendPrompt: vi.fn(),
    });
    getJson.mockImplementation(() =>
      Promise.resolve({ task: task(taskResponseCosts.shift() ?? 0.2) }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("refreshes the header cost while the current task is working", async () => {
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the current task is idle", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it("polls while the current session is retrying", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "retry" },
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("refreshes immediately when a working task becomes visible", async () => {
    setVisible(false);
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    setVisible(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("keeps the current header cost when a working-task refresh fails", async () => {
    getJson.mockResolvedValueOnce({ task: task(0.1) }).mockRejectedValueOnce(new Error("offline"));
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getJson).toHaveBeenCalledTimes(2);
    expect(screen.getByText("累計 $0.1000")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("ignores an older task refresh after a newer refresh completes", async () => {
    let resolveInitial: ((value: { task: TaskSummary }) => void) | undefined;
    getJson
      .mockImplementationOnce(() => new Promise<{ task: TaskSummary }>((resolve) => {
        resolveInitial = resolve;
      }))
      .mockResolvedValueOnce({ task: task(0.2) });
    const view = render(<TaskView taskId="ws1" />);

    await act(async () => {
      await Promise.resolve();
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    view.rerender(<TaskView taskId="ws1" />);

    expect(await screen.findByText("累計 $0.2000")).toBeTruthy();
    await act(async () => {
      resolveInitial?.({ task: task(0.1) });
      await Promise.resolve();
    });

    expect(screen.getByText("累計 $0.2000")).toBeTruthy();
  });
});
