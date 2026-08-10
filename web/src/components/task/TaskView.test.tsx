import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { writeLastUsedModel } from "@/lib/default-model";
import { HANG_RETRY_METADATA_KEY } from "@/lib/hang-retry";
import type { TaskSummary } from "@/lib/types";
import { GOAL_LOOP_TOGGLE_LABEL } from "@/components/GoalLoopComposer";
import { TaskView, __clearTaskViewCachesForTest } from "./TaskView";

const {
  getJson,
  notifyTasksChanged,
  sendJson,
  useSessionStream,
  slashCommands,
  setExtras,
  setActiveScope,
  diffPaneRefreshKeys,
  sessionActionsCompact,
  unrevertSession,
  playSessionCompleteSound,
} = vi.hoisted(() => ({
  getJson: vi.fn(),
  notifyTasksChanged: vi.fn(),
  sendJson: vi.fn(),
  useSessionStream: vi.fn(),
  slashCommands: [] as { name: string }[],
  setExtras: vi.fn(),
  setActiveScope: vi.fn(),
  diffPaneRefreshKeys: [] as number[],
  sessionActionsCompact: vi.fn(),
  unrevertSession: vi.fn(),
  playSessionCompleteSound: vi.fn(),
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
  sendJson,
  timedFetch: (input: RequestInfo | URL) => fetch(input),
}));



vi.mock("@/lib/events", () => ({ notifyTasksChanged }));

vi.mock("@/lib/session-complete-sound", () => ({ playSessionCompleteSound }));

vi.mock("@/lib/currency", () => ({
  formatCost: (cost: number) => `cost $${cost.toFixed(4)}`,
  formatCostValue: (cost: number) => `$${cost.toFixed(4)}`,
  useCostDisplayPrefs: () => ({
    currency: "USD",
    rateMode: "manual",
    usdJpyRate: 150,
  }),
}));

vi.mock("@/lib/useSessionStream", () => ({ useSessionStream }));

vi.mock("@/lib/useSlashCommands", () => ({
  useSlashCommands: () => slashCommands,
}));

// Both helpers return `string | null`; annotate the mocks so tests can
// `mockReturnValue("auto")` without vi.fn() narrowing the return type to null.
const { readDefaultModel, readLastUsedModel } = vi.hoisted(() => ({
  readDefaultModel: vi.fn((): string | null => null),
  readLastUsedModel: vi.fn((): string | null => null),
}));

vi.mock("@/lib/default-model", () => ({
  DEFAULT_MODEL_EVENT: "webui:default-model",
  readDefaultModel,
  readDefaultModelFromServer: () => Promise.resolve(null),
  readLastUsedModel,
  writeDefaultModel: vi.fn(),
  writeLastUsedModel: vi.fn(),
}));

vi.mock("@/components/shell/ShellContext", () => ({
  useShellExtras: () => ({ setExtras }),
  useShellSetActiveScope: () => setActiveScope,
  useShellMobileNav: () => ({
    mobileNavOpen: false,
    openMobileNav: vi.fn(),
    closeMobileNav: vi.fn(),
  }),
}));

vi.mock("@/components/AccessModeSelect", () => ({ AccessModeSelect: () => null }));
vi.mock("@/components/SkillPermissionSelect", () => ({ SkillPermissionSelect: () => null }));
vi.mock("@/components/SubagentPermissionSelect", () => ({ SubagentPermissionSelect: () => null }));
vi.mock("@/components/IntelligenceSelect", () => ({
  IntelligenceSelect: ({
    variants,
    value,
    onChange,
  }: {
    variants: string[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label="インテリジェンス"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">デフォルト</option>
      {variants.map((variant) => (
        <option key={variant} value={variant}>
          {variant}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/components/StatusBadge", () => ({ StatusBadge: () => null }));
vi.mock("./DiffPane", () => ({
  DiffPane: ({ refreshKey }: { refreshKey: number }) => {
    diffPaneRefreshKeys.push(refreshKey);
    return null;
  },
}));
vi.mock("./FileTreePanel", () => ({ FileTreePanel: () => null }));
vi.mock("./GraphPanel", () => ({ GraphPanel: () => null }));
vi.mock("./PartView", () => ({ PartView: () => null }));
vi.mock("./PermissionCard", () => ({ PermissionCard: () => null }));
vi.mock("./PtyPanel", () => ({ PtyPanel: () => <div data-testid="pty-panel" /> }));
vi.mock("./QuestionCard", () => ({ QuestionCard: () => null }));
vi.mock("./SessionActions", () => ({
  CompactButton: () => <button type="button" aria-label="コンパクト">コンパクト</button>,
  MessageRevertButton: () => null,
  unrevertSession,
  useSessionActions: () => ({
    busy: null,
    error: null,
    compact: sessionActionsCompact,
    revert: () => {},
    unrevert: () => {},
  }),
}));
vi.mock("./SessionSwitcher", () => ({
  SessionSwitcher: ({ onSwitch }: { onSwitch: () => void }) => (
    <div data-testid="session-switcher">
      <select aria-label="セッション切替"><option value="sess1">Session 1</option></select>
      <button type="button" aria-label="新セッション" onClick={onSwitch}>追加</button>
    </div>
  ),
}));

let taskStatus: TaskSummary["status"];
let taskResponseCosts: number[];
let taskSessionId: string;
let taskResponseId: string;

function task(cost: number): TaskSummary {
  return {
    id: taskResponseId,
    projectId: "prj1",
    projectName: "Repo",
    title: "Task title",
    directory: "/repo",
    isolation: "current_folder",
    status: taskStatus,
    sessionId: taskSessionId,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("TaskView", () => {
  beforeEach(() => {
    taskStatus = "working";
    taskResponseCosts = [0.1, 0.2];
    taskSessionId = "sess1";
    readDefaultModel.mockReturnValue(null);
    readLastUsedModel.mockReturnValue(null);
    taskResponseId = "ws1";
    __clearTaskViewCachesForTest();
    diffPaneRefreshKeys.length = 0;
    slashCommands.length = 0;
    setVisible(true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
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
      sendCommand: vi.fn(),
    });
    getJson.mockImplementation((path: string) => {
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return Promise.resolve({ task: task(taskResponseCosts.shift() ?? 0.2) });
    });
    sendJson.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    __clearTaskViewCachesForTest();
  });

  it("keeps a single mobile menu button while the task is loading", () => {
    render(<TaskView taskId="ws1" />);

    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    expect(menus[0].getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menus[0].getAttribute("aria-expanded")).toBe("false");
    expect(menus[0].className).toContain("h-11");
    expect(menus[0].className).toContain("w-11");
  });

  it("allows the hang detection notice to be dismissed", async () => {
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      sessionError: "ハング検知後に処理を停止しました",
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByText("ハング検知後に処理を停止しました")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("セッションエラーを閉じる"));
    expect(screen.queryByText("ハング検知後に処理を停止しました")).toBeNull();
  });

  it("keeps a mobile menu button when loading the task fails", async () => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return Promise.reject(new Error("task unavailable"));
    });
    render(<TaskView taskId="ws1" />);

    await screen.findByText("task unavailable");
    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    expect(menus[0].getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menus[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a single mobile menu button in the conversation header", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const menus = screen.getAllByLabelText("メニュー");
    expect(menus).toHaveLength(1);
    const [menu] = menus;
    expect(menu.getAttribute("aria-controls")).toBe("mobile-nav");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });



  it("sends on Enter but leaves Shift+Enter for a newline", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    });
    fireEvent.change(textarea, { target: { value: "keyboard follow-up" } });
    const shiftEnter = createEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    fireEvent(textarea, shiftEnter);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(streamMock.sendPrompt).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() =>
      expect(streamMock.sendPrompt).toHaveBeenCalledWith(
        "keyboard follow-up",
        expect.any(Object),
      ),
    );
  });

  it("keeps a newly created todo plan collapsed while working on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      todos: [{ id: "todo-1", content: "実装する", status: "in_progress" }],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByRole("button", { name: /プラン 0\/1/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByText("実装する")).toBeNull();
  });

  it("warns when the last assistant message is a 完了報告 with incomplete todos and uncommitted files", async () => {
    taskStatus = "idle";
    getJson.mockImplementation((path: string) => {
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return Promise.resolve({ task: { ...task(0.2), filesChanged: 3 } });
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      todos: [{ id: "todo-1", content: "実装する", status: "in_progress" }],
      messages: [
        {
          info: { id: "m1", role: "user", time: { created: Date.now() } },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "お願いします" }],
        },
        {
          info: { id: "m2", role: "assistant", time: { created: Date.now() } },
          parts: [
            {
              id: "p2",
              messageID: "m2",
              type: "text",
              text: "# 完了報告\n\nやったこと",
            },
          ],
        },
      ],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByText("未完了のまま終了")).toBeTruthy();
    expect(
      screen.getByText(/未コミットの変更が3件残っています/),
    ).toBeTruthy();
  });

  it("does not warn when todos are incomplete but the assistant has not finished (not idle)", async () => {
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "busy" },
      todos: [{ id: "todo-1", content: "実装する", status: "in_progress" }],
      messages: [
        {
          info: { id: "m2", role: "assistant", time: { created: Date.now() } },
          parts: [
            { id: "p2", messageID: "m2", type: "text", text: "# 完了報告\n\nやったこと" },
          ],
        },
      ],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByText("未完了のまま終了")).toBeNull();
  });



  it("refreshes the header cost while the current task is working", async () => {
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計コスト $0.1000")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("累計コスト $0.2000")).toBeTruthy();
    // 3 calls: 1 initial sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("shows cumulative cost when the task does not report a cost", async () => {
    taskResponseCosts = [0];
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      messages: [{
        info: {
          id: "assistant-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          tokens: { input: 1_000_000, output: 100_000, reasoning: 0 },
        },
        parts: [{ id: "text-1", type: "text", text: "回答" }],
      }],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByText("累計コスト $0.3200")).toBeTruthy();
    expect(screen.getByTitle("このセッションの累計コスト")).toBeTruthy();
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
    expect(screen.getByText("累計コスト $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    // 2 calls: 1 sidepanel-width (DB migration) + 1 task load. No polls.
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("polls a loop while completion is being verified even when the task is idle", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    const loop = {
      id: "loop1",
      workspaceId: "ws1",
      sessionId: "sess1",
      status: "verifying_completed" as const,
      goal: "verify",
      acceptance: [],
      maxTurns: 2,
      turnCount: 1,
      lastMessageId: "reply",
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
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    let loopPolls = 0;
    let releaseLoopPoll!: (value: unknown) => void;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") return Promise.resolve({ value: null });
      if (path === "/api/tasks/ws1/goal-loop") {
        loopPolls += 1;
        if (loopPolls === 1) {
          return new Promise((resolve) => {
            releaseLoopPoll = resolve;
          });
        }
        return Promise.resolve({ loop });
      }
      return Promise.resolve({ task: task(taskResponseCosts.shift() ?? 0.2), goalLoop: loop });
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(loopPolls).toBe(1);
    releaseLoopPoll({ loop });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("auto-rejects task permission when subagent is denied, leaving others manual", async () => {
    localStorage.setItem("webui:subagent-permission", "deny");
    try {
      const replyPermission = vi.fn().mockResolvedValue(undefined);
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        permissions: [
          {
            id: "perm-task",
            version: "v2",
            sessionID: "sess1",
            permission: "task",
            patterns: [],
            receivedAt: 1,
          },
          {
            id: "perm-edit",
            version: "v2",
            sessionID: "sess1",
            permission: "edit",
            patterns: [],
            receivedAt: 2,
          },
        ],
        replyPermission,
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // task permission is auto-rejected (deny takes priority over full access)
      expect(replyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ id: "perm-task", permission: "task" }),
        "reject",
      );
      // other permissions are untouched by the subagent setting (no auto reply)
      const calls = replyPermission.mock.calls;
      expect(calls.every((c) => c[0]?.id === "perm-task")).toBe(true);
      expect(calls.every((c) => c[1] === "reject")).toBe(true);
    } finally {
      localStorage.removeItem("webui:subagent-permission");
    }
  });

  it("syncs the access mode to the session as an edit ruleset", async () => {
    // Regression: 確認する only stopped the WebUI from auto-approving. OpenCode
    // allows `edit` by default, so edit / write / apply_patch never emitted a
    // permission event and ran with no approval card.
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendJson).toHaveBeenCalledWith("POST", "/api/access-mode", {
      taskId: "ws1",
      sessionId: "sess1",
      mode: "ask",
    });
  });

  it("auto-rejects skill permission when skill use is denied, leaving others manual", async () => {
    localStorage.setItem("webui:skill-permission", "deny");
    try {
      const replyPermission = vi.fn().mockResolvedValue(undefined);
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        permissions: [
          {
            id: "perm-skill",
            version: "v2",
            sessionID: "sess1",
            permission: "skill",
            patterns: [],
            receivedAt: 1,
          },
          {
            id: "perm-edit",
            version: "v2",
            sessionID: "sess1",
            permission: "edit",
            patterns: [],
            receivedAt: 2,
          },
        ],
        replyPermission,
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(replyPermission).toHaveBeenCalledWith(
        expect.objectContaining({ id: "perm-skill", permission: "skill" }),
        "reject",
      );
      const calls = replyPermission.mock.calls;
      expect(calls.every((c) => c[0]?.id === "perm-skill")).toBe(true);
      expect(calls.every((c) => c[1] === "reject")).toBe(true);
    } finally {
      localStorage.removeItem("webui:skill-permission");
    }
  });

  it("polls when the current task is idle but the session is busy", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
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

    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 poll.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("notifies task changes when the stream status type changes", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    const view = render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);

    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "retry" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
    });
    expect(notifyTasksChanged).toHaveBeenCalledTimes(2);

    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
    });

    expect(notifyTasksChanged).toHaveBeenCalledTimes(3);
  });

  it("refreshes immediately when a working task becomes visible", async () => {
    setVisible(false);
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計コスト $0.1000")).toBeTruthy();
    setVisible(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(screen.getByText("累計コスト $0.2000")).toBeTruthy();
    // 3 calls: 1 sidepanel-width (DB migration) + 1 task load + 1 visibility refresh.
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("keeps the current header cost when a working-task refresh fails", async () => {
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      // Initial load succeeds; the first poll refresh fails.
      if (taskCalls === 1) return Promise.resolve({ task: task(0.1) });
      return Promise.reject(new Error("offline"));
    });
    vi.useFakeTimers();
    render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    expect(screen.getByText("累計コスト $0.1000")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("累計コスト $0.1000")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it.each([
    ["a normal prompt", "hello", "sendPrompt"],
    ["a slash command", "/review args", "sendCommand"],
  ])("touches activity before %s and notifies afterward", async (_label, text, method) => {
    taskStatus = "idle";
    if (method === "sendCommand") slashCommands.push({ name: "review" });
    const events: string[] = [];
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    streamMock.sendPrompt.mockImplementation(async () => {
      events.push("send");
    });
    streamMock.sendCommand.mockImplementation(async () => {
      events.push("send");
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();
    const activity = deferred<void>();
    sendJson.mockImplementation((_method: string, url: string) => {
      if (url.endsWith("/refresh-title")) {
        events.push("title");
        return Promise.resolve(undefined);
      }
      return activity.promise.then(() => {
        events.push("activity");
      });
    });
    events.length = 0;

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(streamMock[method]).not.toHaveBeenCalled();

    activity.resolve(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendJson).toHaveBeenCalledWith("POST", "/api/tasks/ws1/activity", {
      sessionId: "sess1",
    });
    expect(sendJson).toHaveBeenCalledWith(
      "POST",
      "/api/workspaces/ws1/sessions/sess1/refresh-title",
    );
    expect(events).toEqual(["activity", "send", "title"]);
    expect(streamMock[method]).toHaveBeenCalledTimes(1);
    if (method === "sendCommand") {
      expect(streamMock.sendCommand).toHaveBeenCalledWith(
        "review",
        "args",
        expect.any(Object),
      );
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
    } else {
      expect(streamMock.sendPrompt).toHaveBeenCalledWith(
        "hello",
        expect.any(Object),
      );
      expect(streamMock.sendCommand).not.toHaveBeenCalled();
    }
    expect(notifyTasksChanged).toHaveBeenCalledTimes(2);
  });

  it("continues sending when the activity request fails", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    const sendPrompt = streamMock.sendPrompt;
    // Only the activity-touch call fails; the sidepanel-width DB write must
    // still succeed so it doesn't emit a noisy warning unrelated to this test.
    sendJson.mockImplementation((method: string, url: string) => {
      if (url === "/api/settings/sidepanel-width") return Promise.resolve(undefined);
      return Promise.reject(new Error("activity unavailable"));
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendPrompt).toHaveBeenCalledWith("hello", expect.any(Object));
    expect(notifyTasksChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fails", () => Promise.reject(new Error("pause unavailable"))],
    ["returns a non-paused status", () => Promise.resolve({ loop: { id: "loop1", status: "running" } })],
  ])(
    "does not manually send when pausing a verifying Goal loop %s",
    async (_caseName, pauseResponse) => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      streamMock.status = { type: "idle" };
      getJson.mockImplementation((path: string) => {
        if (path === "/api/settings/sidepanel-width") return Promise.resolve({ value: null });
        if (path === "/api/tasks/ws1") {
          return Promise.resolve({
            task: task(0.1),
            goalLoop: {
              id: "loop1",
              status: "verifying_completed",
              goal: "verify",
              turnCount: 1,
              maxTurns: 3,
              progress: [],
            },
          });
        }
        return Promise.resolve({ task: task(0.1) });
      });
      sendJson.mockImplementation((_method: string, path: string) => {
        if (path === "/api/tasks/ws1/goal-loop") return pauseResponse();
        return Promise.resolve(undefined);
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const textarea = screen.getByRole("combobox", {
        name: "フォローアップを送信",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "manual follow-up" } });
      fireEvent.click(screen.getByRole("button", { name: "送信" }));

      await waitFor(() => {
        expect(screen.getByText(/ループを一時停止できないため手動送信を中止しました/)).toBeTruthy();
      });
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
      expect(textarea.value).toBe("manual follow-up");
    },
  );

  it("does not send the same composer scope twice from rapid clicks", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    const pendingSend = deferred<void>();
    streamMock.sendPrompt.mockReturnValue(pendingSend.promise);

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    const textarea = screen
      .getAllByRole("combobox")
      .find((element) => element.tagName === "TEXTAREA")!;
    fireEvent.change(textarea, { target: { value: "rapid send" } });
    const sendButton = screen.getAllByRole("button").at(-1)!;
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => expect(streamMock.sendPrompt).toHaveBeenCalledTimes(1));
    pendingSend.resolve(undefined);
  });

  it("does not block sending for more than 5 seconds when activity hangs", async () => {
    taskStatus = "idle";
    vi.useFakeTimers();
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    sendJson.mockReturnValue(new Promise<void>(() => {}));
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(streamMock.sendPrompt).toHaveBeenCalledWith("hello", expect.any(Object));
  });

  it("disables image attachment controls when the selected model lacks image capability", async () => {
    taskStatus = "idle";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [
                {
                  id: "openai",
                  name: "OpenAI",
                  models: {
                    "known-text": {
                      name: "Known Text",
                      capabilities: { input: { image: false }, attachment: false },
                    },
                  },
                },
              ],
              connected: ["openai"],
              default: { openai: "known-text" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };

    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(
      (screen.getByRole("button", { name: "画像を添付" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (view.container.querySelector('input[type="file"]') as HTMLInputElement | null)
        ?.disabled,
    ).toBe(true);
  });

  it("disables image attachment controls after switching to a text-only model", async () => {
    taskStatus = "idle";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [{
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: true }, attachment: false },
                  },
                  text: {
                    name: "Text",
                    capabilities: { input: { image: false }, attachment: false },
                  },
                },
              }],
              connected: ["openai"],
              default: { openai: "vision" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(await screen.findByRole("button", { name: "画像を添付" })).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
    fireEvent.click(await screen.findByRole("option", { name: /Text/ }));

    expect(
      (screen.getByRole("button", { name: "画像を添付" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("sends an image follow-up to a model with explicit image capability", async () => {
    taskStatus = "idle";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [{
                id: "openai",
                name: "OpenAI",
                models: {
                  vision: {
                    name: "Vision",
                    capabilities: { input: { image: true }, attachment: false },
                  },
                },
              }],
              connected: ["openai"],
              default: { openai: "vision" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    const streamMock = useSessionStream();
    streamMock.status = { type: "idle" };
    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const image = new File(["img"], "vision-task.png", { type: "image/png" });
    const input = view.container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { files: [image] } });
    expect(await screen.findByRole("img", { name: "vision-task.png" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "フォローアップを送信" }), {
      target: { value: "describe this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      expect(streamMock.sendPrompt).toHaveBeenCalledWith(
        "describe this",
        expect.objectContaining({
          model: { providerID: "openai", modelID: "vision" },
          files: [expect.objectContaining({ mime: "image/png", name: "vision-task.png" })],
        }),
      );
    });
  });

  it("touches activity before approving a plan", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    const sendPrompt = streamMock.sendPrompt;
    const events: string[] = [];
    sendPrompt.mockImplementation(async () => events.push("send"));
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      visibleMessages: [{
        info: {
          id: "plan-1",
          role: "assistant",
          agent: "plan",
          time: { completed: 1 },
        },
        parts: [{ id: "plan-text", type: "text", text: "/repo/plan.md" }],
      }],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    notifyTasksChanged.mockClear();
    const activity = deferred<void>();
    sendJson.mockImplementation((_method: string, url: string) => {
      if (url.endsWith("/refresh-title")) {
        events.push("title");
        return Promise.resolve(undefined);
      }
      return activity.promise.then(() => {
        events.push("activity");
      });
    });
    events.length = 0;

    const planCard = await screen.findByRole("region", { name: "計画書: plan.md" });
    fireEvent.click(within(planCard).getByRole("button", { name: "承認して実装" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(sendPrompt).not.toHaveBeenCalled();

    activity.resolve(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(events).toEqual(["activity", "send", "title"]);
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.stringContaining("この計画を承認します"),
      { agent: "build", sessionId: "sess1" },
    );
    expect(notifyTasksChanged).toHaveBeenCalledTimes(2);
  });

  it("shows the plan card expanded with its document on desktop", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({
      ...streamMock,
      visibleMessages: [{
        info: {
          id: "plan-1",
          role: "assistant",
          agent: "plan",
          time: { completed: 1 },
        },
        parts: [{ id: "plan-text", type: "text", text: "/repo/plan.md" }],
      }],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const card = await screen.findByRole("region", { name: "計画書: plan.md" });
    expect(
      within(card).getByRole("button", { name: "plan.md" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(card).getByText("計画本文")).toBeTruthy();
  });

  it("stops polling after idle even when the completion refresh fails", async () => {
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      if (taskCalls === 1) return Promise.resolve({ task: task(0.1) });
      return Promise.reject(new Error("offline"));
    });
    vi.useFakeTimers();
    const view = render(<TaskView taskId="ws1" />);

    await flushTaskLoad();
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    await act(async () => {
      view.rerender(<TaskView taskId="ws1" />);
      await Promise.resolve();
    });

    expect(playSessionCompleteSound).toHaveBeenCalledTimes(1);
    // Initial load + one failed poll refresh while working.
    expect(taskCalls).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(taskCalls).toBe(2);
  });

  it("ignores a task refresh that resolves after unmount", async () => {
    let resolveTaskRequest!: (value: { task: TaskSummary }) => void;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      return new Promise<{ task: TaskSummary }>((resolve) => {
        resolveTaskRequest = resolve;
      });
    });
    const view = render(<TaskView taskId="ws1" />);
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();

    await act(async () => {
      resolveTaskRequest({ task: task(0.2) });
      await Promise.resolve();
    });
  });

  it("ignores an older task refresh after a newer refresh completes", async () => {
    let resolveInitial: ((value: { task: TaskSummary }) => void) | undefined;
    let taskCalls = 0;
    getJson.mockImplementation((path: string) => {
      if (path === "/api/settings/sidepanel-width") {
        return Promise.resolve({ value: null });
      }
      if (path === "/api/files/content") {
        return Promise.resolve({ name: "plan.md", content: "計画本文" });
      }
      taskCalls += 1;
      // Initial load stays pending; the first poll refresh resolves with 0.2.
      if (taskCalls === 1) {
        return new Promise<{ task: TaskSummary }>((resolve) => {
          resolveInitial = resolve;
        });
      }
      return Promise.resolve({ task: task(0.2) });
    });
    const view = render(<TaskView taskId="ws1" />);

    await act(async () => {
      await Promise.resolve();
    });
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
    });
    view.rerender(<TaskView taskId="ws1" />);

    expect(await screen.findByText("累計コスト $0.2000")).toBeTruthy();
    await act(async () => {
      resolveInitial?.({ task: task(0.1) });
      await Promise.resolve();
    });

    expect(screen.getByText("累計コスト $0.2000")).toBeTruthy();
  });

  it("consolidates assistant model and turn cost into the response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/opencode/provider")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              all: [{
                id: "openai",
                name: "OpenAI",
                models: { "gpt-5.6-sol": { name: "GPT-5.6 Sol" } },
              }],
              connected: ["openai"],
              default: { openai: "gpt-5.6-sol" },
            }),
          });
        }
        return Promise.resolve({ ok: false });
      }),
    );
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      messages: [{
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "build",
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          cost: 0.25,
          time: { created: 1 },
        },
        parts: [{ id: "text-1", type: "text", text: "回答" }],
      }],
      visibleMessages: [{
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "build",
          providerID: "openai",
          modelID: "gpt-5.6-sol",
          cost: 0.25,
          time: { created: 1 },
        },
        parts: [{ id: "text-1", type: "text", text: "回答" }],
      }],
    });

    render(<TaskView taskId="ws1" />);
    // Scope to the response header (aria-label from Task 1's MessageMetaHeader):
    // the model label also legitimately renders in the composer's model selector.
    const header = await screen.findByLabelText("応答メタデータ");
    await within(header).findByText("GPT-5.6 Sol");
    expect(within(header).getByText("コスト $0.2500")).toBeTruthy();
    expect(screen.queryByText("build")).toBeNull();
    expect(screen.getAllByText("コスト $0.2500")).toHaveLength(1);
  });

  // The server-side watchdog hides the prompt it re-sent (it would otherwise
  // appear twice), so the notice is the only trace of the recovery.
  // See docs/specs/hang-watchdog-server-side.md.
  it("reports that the hang watchdog automatically resumed the turn", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    const resumed = {
      info: { id: "user-retry", role: "user", time: { created: 2 } },
      parts: [
        {
          id: "text-retry",
          type: "text",
          text: "続けて",
          metadata: { [HANG_RETRY_METADATA_KEY]: true },
        },
      ],
    };
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      messages: [resumed],
      visibleMessages: [],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const notice = await screen.findByTestId("hang-resume-notice");
    expect(notice.textContent).toContain("自動的に停止し、同じ処理を再開しました");
    expect(notice.textContent).toContain("5分");
    expect(notice.textContent).not.toContain("回）");
  });

  it("automatically closes the hang-resume notice after 30 seconds", async () => {
    vi.useFakeTimers();
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      messages: [
        {
          info: { id: "user-retry", role: "user", time: { created: 2 } },
          parts: [
            {
              id: "text-retry",
              type: "text",
              text: "続けて",
              metadata: { [HANG_RETRY_METADATA_KEY]: true },
            },
          ],
        },
      ],
      visibleMessages: [],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    expect(screen.getByTestId("hang-resume-notice")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(29_999);
    });
    expect(screen.getByTestId("hang-resume-notice")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("hang-resume-notice")).toBeNull();
  });

  it("counts repeated automatic resumes", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    const resumed = (id: string) => ({
      info: { id, role: "user", time: { created: 2 } },
      parts: [
        {
          id: `text-${id}`,
          type: "text",
          text: "続けて",
          metadata: { [HANG_RETRY_METADATA_KEY]: true },
        },
      ],
    });
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      messages: [resumed("r1"), resumed("r2")],
      visibleMessages: [],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const notice = await screen.findByTestId("hang-resume-notice");
    expect(notice.textContent).toContain("（2回）");
  });

  // The notice is informational and closes automatically after 30 seconds,
  // while remaining manually closable for the resumes the user acknowledged.
  it("closes the automatic-resume notice and reopens it after a further resume", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    const resumed = (id: string) => ({
      info: { id, role: "user", time: { created: 2 } },
      parts: [
        {
          id: `text-${id}`,
          type: "text",
          text: "続けて",
          metadata: { [HANG_RETRY_METADATA_KEY]: true },
        },
      ],
    });
    const withMessages = (messages: unknown[]) => ({
      ...streamMock,
      status: { type: "idle" },
      messages,
      visibleMessages: [],
    });
    useSessionStream.mockReturnValue(withMessages([resumed("r1")]));

    const view = render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    await screen.findByTestId("hang-resume-notice");

    fireEvent.click(screen.getByLabelText("自動再開の通知を閉じる"));
    expect(screen.queryByTestId("hang-resume-notice")).toBeNull();

    useSessionStream.mockReturnValue(withMessages([resumed("r1"), resumed("r2")]));
    view.rerender(<TaskView taskId="ws1" />);
    const reopened = await screen.findByTestId("hang-resume-notice");
    expect(reopened.textContent).toContain("（2回）");
  });

  it("shows no hang notice for an ordinary turn", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({
      ...streamMock,
      status: { type: "idle" },
      messages: [
        {
          info: { id: "user-1", role: "user", time: { created: 1 } },
          parts: [{ id: "text-1", type: "text", text: "hello" }],
        },
      ],
      visibleMessages: [],
    });

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByTestId("hang-resume-notice")).toBeNull();
  });

  it("keeps resync and terminal as standalone header buttons", async () => {
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const headerActions = screen.getByRole("group", { name: "タスク操作" });
    expect(headerActions.getAttribute("tabindex")).toBe("0");
    expect(headerActions.className).toContain("overflow-x-auto");

    expect(screen.queryByRole("button", { name: "メニューを開く" })).toBeNull();
    expect(screen.queryByTitle("作業パスをコピー")).toBeNull();
    expect(screen.queryByTestId("session-switcher")).toBeNull();
    const resyncButton = screen.getByRole("button", { name: "再同期" });
    expect(resyncButton).toBeTruthy();
    expect(resyncButton.className).toContain("h-11");
    expect(screen.getByRole("button", { name: "ターミナル" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コンパクト" })).toBeTruthy();
    expect(within(headerActions).getByRole("button", { name: "ファイルツリー" })).toBeTruthy();
    expect(within(headerActions).getByRole("button", { name: "グラフ" })).toBeTruthy();
    expect(within(headerActions).getByRole("button", { name: "Diff パネル" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "再同期" }));
    expect(streamMock.resync).toHaveBeenCalledTimes(1);
    // DiffPane only renders when sidePanel === "diff"; open it first.
    fireEvent.click(within(headerActions).getByRole("button", { name: "Diff パネル" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "再同期" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "再同期" }));
    await waitFor(() => expect(diffPaneRefreshKeys).toContain(1));

    fireEvent.click(screen.getByRole("button", { name: "ターミナル" }));
    expect(screen.getByTestId("pty-panel")).toBeTruthy();
  });

  it("exposes stop in the header when working on mobile", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    taskStatus = "working";
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
      sendCommand: vi.fn(),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const header = document.querySelector("header");
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).queryByRole("button", { name: "タスクを停止" })).toBeNull();
    expect(screen.getByRole("button", { name: "生成を停止" })).toBeTruthy();
  });

  it("keeps files, graph, diff, and terminal below md while resync stays visible and terminal moves into the kebab menu", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    taskStatus = "idle";
    const streamMock = useSessionStream();
    useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const headerActions = screen.getByRole("group", { name: "タスク操作" });
    expect(within(headerActions).queryByRole("button", { name: "ファイルツリー" })).toBeNull();
    expect(within(headerActions).queryByRole("button", { name: "グラフ" })).toBeNull();
    expect(within(headerActions).queryByRole("button", { name: "Diff パネル" })).toBeNull();
    expect(screen.getByRole("button", { name: "再同期" })).toBeTruthy();
    // Below md the terminal button is no longer a standalone header icon —
    // it moves into the mobile kebab menu alongside the other panel toggles.
    expect(screen.queryByRole("button", { name: "ターミナル" })).toBeNull();
    expect(screen.getByRole("button", { name: "メニューを開く" })).toBeTruthy();
  });

  describe("パネルトグル", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("defaults to graph panel active on fresh render", async () => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const headerActions = screen.getByRole("group", { name: "タスク操作" });
      const graphBtn = within(headerActions).getByRole("button", { name: "グラフ" });
      expect(graphBtn.className.split(/\s+/)).toContain("bg-surface-2");
      expect(graphBtn.className.split(/\s+/)).toContain("text-text");
    });

    it("toggles files panel off on second click", async () => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const headerActions = screen.getByRole("group", { name: "タスク操作" });
      const filesBtn = within(headerActions).getByRole("button", { name: "ファイルツリー" });
      // First click: open files panel
      fireEvent.click(filesBtn);
      expect(filesBtn.className.split(/\s+/)).toContain("bg-surface-2");

      // Second click: close the panel
      fireEvent.click(filesBtn);
      expect(filesBtn.className.split(/\s+/)).not.toContain("bg-surface-2");
    });

    it("toggles graph panel off on second click", async () => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const headerActions = screen.getByRole("group", { name: "タスク操作" });
      const graphBtn = within(headerActions).getByRole("button", { name: "グラフ" });
      // Graph starts active (default) but tab is "chat"; first click
      // switches to diff tab (graph stays active).
      fireEvent.click(graphBtn);
      expect(graphBtn.className.split(/\s+/)).toContain("bg-surface-2");

      // Second click: same panel + diff tab → close
      fireEvent.click(graphBtn);
      expect(graphBtn.className.split(/\s+/)).not.toContain("bg-surface-2");

      // Third click reopens
      fireEvent.click(graphBtn);
      expect(graphBtn.className.split(/\s+/)).toContain("bg-surface-2");
    });

    it("toggles terminal panel off on second click", async () => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const termBtn = screen.getByRole("button", { name: "ターミナル" });
      // First click: open terminal (switches to diff tab)
      fireEvent.click(termBtn);
      expect(termBtn.className.split(/\s+/)).toContain("bg-surface-2");

      // Second click: close
      fireEvent.click(termBtn);
      expect(termBtn.className.split(/\s+/)).not.toContain("bg-surface-2");
    });

    it("reopens panel after close on re-click", async () => {
      taskStatus = "idle";
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({ ...streamMock, status: { type: "idle" } });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const termBtn = screen.getByRole("button", { name: "ターミナル" });
      // Open
      fireEvent.click(termBtn);
      expect(termBtn.className.split(/\s+/)).toContain("bg-surface-2");
      // Close
      fireEvent.click(termBtn);
      expect(termBtn.className.split(/\s+/)).not.toContain("bg-surface-2");
      // Reopen
      fireEvent.click(termBtn);
      expect(termBtn.className.split(/\s+/)).toContain("bg-surface-2");
    });
  });

  describe("ループ composer", () => {
    const TOGGLE = "ループで継続実行";

    /**
     * Idle session with an optional loop attached to the task response.
     * `stream` is passed in by the caller: `useSessionStream` may only be
     * invoked from the anonymous test callback (react-hooks/rules-of-hooks).
     */
    function setupIdle(
      stream: { status: { type: string } },
      loop: unknown = undefined,
    ) {
      taskStatus = "idle";
      stream.status = { type: "idle" };
      getJson.mockImplementation((path: string) => {
        if (path === "/api/settings/sidepanel-width") {
          return Promise.resolve({ value: null });
        }
        if (path === "/api/tasks/ws1") {
          return Promise.resolve({
            task: task(0.1),
            ...(loop === undefined ? {} : { goalLoop: loop }),
          });
        }
        if (path === "/api/tasks/ws1/goal-loop") {
          return Promise.resolve({ loop: loop ?? null });
        }
        return Promise.resolve({ task: task(0.1) });
      });
    }

    it("keeps the transcript free of a standing start form and offers a composer toggle", async () => {
      setupIdle(useSessionStream());
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      // The old always-on card used these two fields at the top of the scroller.
      expect(screen.queryByText("ループを開始")).toBeNull();
      expect(screen.queryByLabelText("承認条件")).toBeNull();
      expect(screen.getByRole("button", { name: TOGGLE })).toBeTruthy();
    });

    it("reveals acceptance/maxTurns only after the toggle is pressed", async () => {
      setupIdle(useSessionStream());
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));
      expect(screen.getByLabelText("承認条件")).toBeTruthy();
      expect(screen.getByLabelText("最大ターン数")).toBeTruthy();
      expect(
        (screen.getByRole("combobox", { name: "フォローアップを送信" }) as HTMLTextAreaElement)
          .placeholder,
      ).toContain("達成したい目標");

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));
      expect(screen.queryByLabelText("承認条件")).toBeNull();
    });

    it("restores a stopped loop's goal and settings when the composer is reopened", async () => {
      const stoppedLoop = {
        id: "loop-stopped",
        workspaceId: "ws1",
        sessionId: "sess1",
        status: "stopped" as const,
        goal: "停止前の目標",
        acceptance: ["テストが通る", "lint が通る"],
        maxTurns: 7,
        turnCount: 2,
        lastMessageId: null,
        lastPromptAt: null,
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-opus-5",
        variant: "high" as const,
        progress: [],
        summary: "",
        evidence: "",
        blockedReason: "",
        error: "",
        revision: 3,
        turnKind: "goal" as const,
        pauseReason: "" as const,
        rejectedClaims: 0,
        pauseRequested: false,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:10:00Z",
      };
      setupIdle(useSessionStream(), stoppedLoop);
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));

      expect(
        (screen.getByRole("combobox", { name: "フォローアップを送信" }) as HTMLTextAreaElement)
          .value,
      ).toBe("停止前の目標");
      expect((screen.getByLabelText("承認条件") as HTMLTextAreaElement).value).toBe(
        "テストが通る\nlint が通る",
      );
      expect((screen.getByLabelText("最大ターン数") as HTMLInputElement).value).toBe("7");
    });

    it("starts the loop with the composer text as the goal instead of sending a prompt", async () => {
      const streamMock = useSessionStream();
      setupIdle(streamMock);
      const loop = {
        id: "loop1",
        status: "running",
        goal: "ship the loop UI",
        turnCount: 0,
        maxTurns: 10,
        progress: [],
      };
      sendJson.mockImplementation((method: string, path: string) => {
        if (path === "/api/tasks/ws1/goal-loop") return Promise.resolve({ loop });
        return Promise.resolve(undefined);
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));
      fireEvent.change(screen.getByLabelText("承認条件"), {
        target: { value: " tests pass \n\n lint clean " },
      });
      const textarea = screen.getByRole("combobox", {
        name: "フォローアップを送信",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "ship the loop UI" } });
      fireEvent.click(screen.getByRole("button", { name: "ループを開始" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/tasks/ws1/goal-loop",
        expect.objectContaining({
          sessionId: "sess1",
          goal: "ship the loop UI",
          acceptance: ["tests pass", "lint clean"],
          maxTurns: 10,
        }),
      );
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
      expect(textarea.value).toBe("");
      // Live loop => the panel owns the controls, so the pill disappears.
      expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
    });

    it("restores the draft and surfaces the error when the loop cannot start", async () => {
      setupIdle(useSessionStream());
      sendJson.mockImplementation((method: string, path: string) => {
        if (path === "/api/tasks/ws1/goal-loop") {
          return Promise.reject(new Error("loop rejected"));
        }
        return Promise.resolve(undefined);
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));
      const textarea = screen.getByRole("combobox", {
        name: "フォローアップを送信",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "ship the loop UI" } });
      fireEvent.click(screen.getByRole("button", { name: "ループを開始" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByText("loop rejected")).toBeTruthy();
      expect(textarea.value).toBe("ship the loop UI");
      // Still in goal mode so the user can retry without re-toggling.
      expect(screen.getByLabelText("承認条件")).toBeTruthy();
    });

    it("rejects an attachment-only Goal loop without clearing the attachment", async () => {
      setupIdle(useSessionStream());
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          if (String(input).includes("/api/opencode/provider")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                all: [
                  {
                    id: "anthropic",
                    name: "Anthropic",
                    models: {
                      "claude-opus-5": {
                        capabilities: { input: { image: true } },
                      },
                    },
                  },
                ],
                connected: ["anthropic"],
                default: { anthropic: "claude-opus-5" },
              }),
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );
      const view = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      const image = new File(["image"], "reference.png", {
        type: "image/png",
      });
      fireEvent.change(
        view.container.querySelector('input[type="file"]') as HTMLInputElement,
        { target: { files: [image] } },
      );
      expect(await screen.findByRole("img", { name: "reference.png" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: TOGGLE }));
      const textarea = screen.getByRole("combobox", {
        name: "フォローアップを送信",
      }) as HTMLTextAreaElement;
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(
        await screen.findByText(
          "ループでは添付ファイルを利用できません。添付を削除してから開始してください。",
        ),
      ).toBeTruthy();
      expect(sendJson).not.toHaveBeenCalledWith(
        "POST",
        "/api/tasks/ws1/goal-loop",
        expect.anything(),
      );
      expect(textarea.value).toBe("");
      expect(screen.getByRole("img", { name: "reference.png" })).toBeTruthy();
      expect(screen.getByLabelText("添付を削除")).toBeTruthy();
    });

    it("hides the composer toggle while a loop is already live", async () => {
      setupIdle(useSessionStream(), {
        id: "loop1",
        status: "paused",
        goal: "g",
        turnCount: 1,
        maxTurns: 10,
        progress: [],
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
      expect(screen.getByRole("region", { name: "ループ" })).toBeTruthy();
    });
  });

  describe("auto model decision", () => {
    const decision = {
      providerID: "anthropic",
      modelID: "claude-haiku-4-5",
      variant: "minimal",
      tier: "light",
      mode: "cost",
      reason: "短い質問タスクのためコスト優先で選択しました",
      escalation: {
        providerID: "anthropic",
        modelID: "claude-opus-5",
        variant: "high",
      },
    };
    const CHIP_TEXT =
      "Auto: anthropic/claude-haiku-4-5 · effort minimal — 短い質問タスクのためコスト優先で選択しました";
    const RETRY_TEXT =
      "Auto の選択モデルでエラーが発生したため anthropic/claude-opus-5 で再試行しました";
    const CLOSE_LABEL = "Auto の選定結果を閉じる";

    function writeRecord(record: Record<string, unknown>) {
      sessionStorage.setItem("webui:auto-task:ws1", JSON.stringify(record));
    }

    function storedRecord() {
      return JSON.parse(sessionStorage.getItem("webui:auto-task:ws1") ?? "null");
    }

    function userMessage(id = "m1") {
      return {
        info: { id, role: "user", time: { created: 1 } },
        parts: [{ id: `${id}-p`, messageID: id, type: "text", text: "これは何" }],
      };
    }

    function completedAssistantMessage() {
      return {
        info: {
          id: "m2",
          role: "assistant",
          time: { created: 2, completed: 3 },
        },
        parts: [{ id: "m2-p", messageID: "m2", type: "text", text: "回答" }],
      };
    }

    /**
     * Alias for reading the value configured in `beforeEach`. Calling
     * `useSessionStream()` directly inside a named helper trips
     * `react-hooks/rules-of-hooks`, even though this is a plain mock.
     */
    const readStream = useSessionStream as unknown as () => Record<
      string,
      unknown
    >;

    /** Base stream with a stable sendPrompt so effect deps stay stable. */
    function streamWith(overrides: Record<string, unknown> = {}) {
      const sendPrompt = vi.fn().mockResolvedValue(undefined);
      const base = {
        ...readStream(),
        status: { type: "idle" },
        messages: [userMessage()],
        sendPrompt,
        ...overrides,
      };
      useSessionStream.mockReturnValue(base);
      return { base, sendPrompt };
    }

    /** Flip sessionError from null to non-null and let effects settle. */
    async function raiseSessionError(
      base: Record<string, unknown>,
      rerender: (ui: ReactElement) => void,
    ) {
      useSessionStream.mockReturnValue({ ...base, sessionError: "boom" });
      await act(async () => {
        rerender(<TaskView taskId="ws1" />);
        await Promise.resolve();
      });
    }

    beforeEach(() => {
      taskStatus = "idle";
      sessionStorage.clear();
      localStorage.clear();
      // These cases assert the banner *content*, so opt in to naming the
      // resolved model. The default-off behaviour is covered separately.
      localStorage.setItem("webui:auto-show-model", "1");
    });

    afterEach(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    it("shows the selection chip and persists a dismissal without dropping the key", async () => {
      writeRecord({ decision });
      streamWith();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(screen.getByText(CHIP_TEXT)).toBeTruthy();
      const close = screen.getByLabelText(CLOSE_LABEL);
      expect(close.classList.contains("h-8")).toBe(true);
      expect(close.classList.contains("w-8")).toBe(true);
      fireEvent.click(close);

      expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();
      expect(screen.queryByText(CHIP_TEXT)).toBeNull();
      expect(storedRecord()).toEqual({ decision, dismissed: true });
    });

    it("omits the effort segment when the decision has no variant", async () => {
      writeRecord({ decision: { ...decision, variant: "" } });
      streamWith();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(
        screen.getByText(
          "Auto: anthropic/claude-haiku-4-5 — 短い質問タスクのためコスト優先で選択しました",
        ),
      ).toBeTruthy();
    });

    it("stays hidden when the chip was already dismissed", async () => {
      writeRecord({ decision, dismissed: true });
      streamWith();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();
    });

    it("renders no chip for a task without an auto record", async () => {
      streamWith();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();
    });

    it("retries once with the escalation model, variant and agent", async () => {
      writeRecord({ decision, prompt: "これは何", agent: "build" });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      expect(sendPrompt).not.toHaveBeenCalled();

      await raiseSessionError(base, rerender);

      expect(sendPrompt).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledWith("これは何", {
        model: { providerID: "anthropic", modelID: "claude-opus-5" },
        variant: "high",
        agent: "build",
        sessionId: "sess1",
      });
      // `retried` is persisted before the send so a reload cannot repeat it.
      expect(storedRecord().retried).toBe(true);
      expect(await screen.findByText(RETRY_TEXT)).toBeTruthy();
      expect(screen.queryByText(CHIP_TEXT)).toBeNull();

      // A further render with the error still present must not re-send.
      await act(async () => {
        rerender(<TaskView taskId="ws1" />);
        await Promise.resolve();
      });
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });

    it("shows a later retry notice after the selection chip was dismissed", async () => {
      writeRecord({ decision, prompt: "これは何" });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByLabelText(CLOSE_LABEL));
      expect(screen.queryByText(CHIP_TEXT)).toBeNull();

      await raiseSessionError(base, rerender);

      expect(sendPrompt).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(RETRY_TEXT)).toBeTruthy();
    });

    it("omits the retry variant when the escalation has none", async () => {
      writeRecord({
        decision: {
          ...decision,
          escalation: { ...decision.escalation, variant: "" },
        },
        prompt: "これは何",
      });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).toHaveBeenCalledWith("これは何", {
        model: { providerID: "anthropic", modelID: "claude-opus-5" },
        sessionId: "sess1",
      });
    });

    it("does not retry when the record is already marked retried", async () => {
      writeRecord({ decision, prompt: "これは何", retried: true });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry when no prompt was stored", async () => {
      writeRecord({ decision });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry when the decision has no escalation target", async () => {
      writeRecord({
        decision: {
          providerID: decision.providerID,
          modelID: decision.modelID,
          variant: decision.variant,
          tier: decision.tier,
          reason: decision.reason,
        },
        prompt: "これは何",
      });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry once a completed assistant reply exists", async () => {
      writeRecord({ decision, prompt: "これは何" });
      const { base, sendPrompt } = streamWith({
        messages: [userMessage(), completedAssistantMessage()],
      });
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry a follow-up failure (more than one user message)", async () => {
      writeRecord({ decision, prompt: "これは何" });
      const { base, sendPrompt } = streamWith({
        messages: [userMessage("m1"), userMessage("m3")],
      });
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry for a task without an auto record", async () => {
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("does not retry when the error was already present on mount", async () => {
      writeRecord({ decision, prompt: "これは何" });
      const { sendPrompt } = streamWith({ sessionError: "boom" });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(sendPrompt).not.toHaveBeenCalled();
    });

    it("aborts the retry when the retried flag cannot be persisted", async () => {
      writeRecord({ decision, prompt: "これは何" });
      const { base, sendPrompt } = streamWith();
      const { rerender } = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      // Reads keep working; only the write fails (quota / disabled storage).
      // `vi.spyOn` cannot be used here: jsdom's Storage proxy turns a method
      // re-definition into a stored entry instead of overriding it.
      const real = window.sessionStorage;
      vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => real.getItem(key),
        removeItem: (key: string) => real.removeItem(key),
        clear: () => real.clear(),
        key: (index: number) => real.key(index),
        get length() {
          return real.length;
        },
        setItem: () => {
          throw new Error("quota exceeded");
        },
      });
      await raiseSessionError(base, rerender);

      expect(sendPrompt).not.toHaveBeenCalled();
    });
  });

  describe("follow-up auto model", () => {
    const CLOSE_LABEL = "Auto の選定結果を閉じる";

    /**
     * Two cost tiers plus an image-only model so tier selection, the image
     * filter and the effort choice are all observable through the send opts.
     */
    function providerPayload() {
      return {
        all: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-haiku-4-5": {
                name: "Claude Haiku 4.5",
                variants: { minimal: {}, low: {}, high: {} },
                capabilities: { input: { image: false }, attachment: false },
              },
              "claude-opus-5": {
                name: "Claude Opus 5",
                variants: { medium: {}, high: {} },
                capabilities: { input: { image: true }, attachment: false },
              },
            },
          },
        ],
        connected: ["anthropic"],
        default: { anthropic: "claude-haiku-4-5" },
      };
    }

    function stubProviderFetch(payload: unknown = providerPayload()) {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          if (String(input).includes("/api/opencode/provider")) {
            return Promise.resolve({ ok: true, json: async () => payload });
          }
          return Promise.resolve({ ok: false });
        }),
      );
    }

    /** Pick Auto in the composer's model dropdown. */
    async function selectAuto() {
      fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
      fireEvent.click(
        await screen.findByRole("option", { name: "Auto" }),
      );
    }

    async function typeAndSend(text: string) {
      fireEvent.change(
        screen.getByRole("combobox", { name: "フォローアップを送信" }),
        { target: { value: text } },
      );
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    }

    beforeEach(() => {
      taskStatus = "idle";
      sessionStorage.clear();
      localStorage.clear();
      // Naming the resolved model is off by default; these cases assert the
      // notice text, so opt in. Default-off behaviour is covered separately.
      localStorage.setItem("webui:auto-show-model", "1");
      stubProviderFetch();
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        status: { type: "idle" },
      });
    });

    afterEach(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    it("offers Auto as the first option in the model dropdown", async () => {
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
      const modelMenu = await screen.findByRole("listbox", { name: "モデル" });
      const options = within(modelMenu).getAllByRole("option");
      expect(options[0].textContent).toContain("Auto");
    });

    it("treats an explicit empty connected list as no available providers", async () => {
      stubProviderFetch({ ...providerPayload(), connected: [] });
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
      const modelMenu = await screen.findByRole("listbox", { name: "モデル" });
      expect(within(modelMenu).getAllByRole("option")).toHaveLength(1);
      fireEvent.click(
        within(modelMenu).getByRole("option", { name: "Auto" }),
      );
      await typeAndSend("なぜ失敗するのか");

      expect(
        await screen.findByText(
          "Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。",
        ),
      ).toBeTruthy();
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
    });

    it("keeps omitted connected compatible with legacy unrestricted responses", async () => {
      stubProviderFetch({ ...providerPayload(), connected: undefined });
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("なぜ失敗するのか");

      await waitFor(() =>
        expect(streamMock.sendPrompt).toHaveBeenCalledWith(
          "なぜ失敗するのか",
          expect.objectContaining({
            model: {
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
            },
          }),
        ),
      );
    });

    it("resolves a cheap model with a minimal effort for a short question", async () => {
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("なぜ失敗するのか");

      await waitFor(() =>
        expect(streamMock.sendPrompt).toHaveBeenCalledWith(
          "なぜ失敗するのか",
          expect.objectContaining({
            model: {
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
            },
            variant: "minimal",
            sessionId: "sess1",
          }),
        ),
      );
    });

    it("uses a low effort for a standard coding follow-up", async () => {
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("ログ出力を追加して");

      await waitFor(() =>
        expect(streamMock.sendPrompt).toHaveBeenCalledWith(
          "ログ出力を追加して",
          expect.objectContaining({
            model: {
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
            },
            variant: "low",
          }),
        ),
      );
    });

    it("escalates to the strongest model for a heavy task", async () => {
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("認証周りを全面的にリファクタリングして");

      await waitFor(() =>
        expect(streamMock.sendPrompt).toHaveBeenCalledWith(
          "認証周りを全面的にリファクタリングして",
          expect.objectContaining({
            model: { providerID: "anthropic", modelID: "claude-opus-5" },
            variant: "medium",
          }),
        ),
      );
    });

    it("resolves a slash command the same way", async () => {
      slashCommands.push({ name: "review" });
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("/review なぜ失敗するのか");

      await waitFor(() =>
        expect(streamMock.sendCommand).toHaveBeenCalledWith(
          "review",
          "なぜ失敗するのか",
          expect.objectContaining({
            model: {
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
            },
            variant: "minimal",
          }),
        ),
      );
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
    });

    it("shows the resolution notice and closes it on demand", async () => {
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("なぜ失敗するのか");

      const notice = await screen.findByText(
        "Auto: anthropic/claude-haiku-4-5 · effort minimal — 短い質問タスクのためコスト優先で選択しました",
      );
      expect(notice).toBeTruthy();
      fireEvent.click(screen.getByLabelText(CLOSE_LABEL));
      expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();
    });

    it("remembers Auto as the last used model", async () => {
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("なぜ失敗するのか");

      await waitFor(() =>
        expect(writeLastUsedModel).toHaveBeenCalledWith("auto"),
      );
    });

    it("keeps Auto selected when an assistant reply arrives (HomeView carryover)", async () => {
      // HomeView writes the model actually applied on submission via
      // writeLastUsedModel("auto"). TaskView reads it back on mount so the
      // composer starts on Auto, and the first assistant reply (which
      // carries the concrete model Auto resolved to) must NOT flip the
      // dropdown — the user keeps Auto for every follow-up.
      readLastUsedModel.mockReturnValue("auto");
      localStorage.setItem("webui:default-model", "anthropic::claude-opus-5");
      sessionStorage.setItem(
        "webui:auto-task:ws1",
        JSON.stringify({
          decision: {
            providerID: "anthropic",
            modelID: "claude-haiku-4-5",
            variant: "minimal",
            tier: "light",
            mode: "cost",
            reason: "test",
          },
        }),
      );
      const streamMock = useSessionStream();
      useSessionStream.mockReturnValue({
        ...streamMock,
        messages: [
          {
            info: {
              id: "assistant-1",
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
              cost: 0,
              time: { created: 1 },
            },
            parts: [{ id: "text-1", type: "text", text: "回答" }],
          },
        ],
        visibleMessages: [
          {
            info: {
              id: "assistant-1",
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
              cost: 0,
              time: { created: 1 },
            },
            parts: [{ id: "text-1", type: "text", text: "回答" }],
          },
        ],
        loaded: true,
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      // The composer dropdown should remain on Auto, not flip to
      // anthropic/claude-haiku-4-5. The menu is opened exactly once here: the
      // trigger is a toggle, and clicking a toggle inside waitFor makes the
      // retry (which also re-runs on every DOM mutation) flip the menu open
      // and shut forever, starving the event loop so no timeout can fire.
      // waitFor then only observes, covering the async provider fetch and the
      // seeded-model effect that runs once stream + options settle.
      fireEvent.click(screen.getByRole("combobox", { name: "モデル" }));
      const modelMenu = await screen.findByRole("listbox", { name: "モデル" });
      await waitFor(() => {
        const selected = within(modelMenu).getAllByRole("option", {
          selected: true,
        });
        expect(selected.length).toBeGreaterThan(0);
        expect(selected[0].textContent).toContain("Auto");
      });
    });

    it("keeps the agent model when the agent pins one", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/opencode/provider")) {
            return Promise.resolve({
              ok: true,
              json: async () => providerPayload(),
            });
          }
          if (url.includes("/api/opencode/agent")) {
            return Promise.resolve({
              ok: true,
              json: async () => [
                {
                  name: "build",
                  model: { providerID: "openai", modelID: "gpt-5.6" },
                },
              ],
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      fireEvent.change(await screen.findByLabelText("エージェント"), {
        target: { value: "build" },
      });
      await typeAndSend("なぜ失敗するのか");

      await waitFor(() => expect(streamMock.sendPrompt).toHaveBeenCalled());
      const opts = streamMock.sendPrompt.mock.calls[0][1];
      expect(opts.model).toBeUndefined();
      expect(opts.variant).toBeUndefined();
      expect(opts.agent).toBe("build");
    });

    it("forwards manual Intelligence when Auto defers to an agent model", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/opencode/provider")) {
            return Promise.resolve({
              ok: true,
              json: async () => providerPayload(),
            });
          }
          if (url.includes("/api/opencode/agent")) {
            return Promise.resolve({
              ok: true,
              json: async () => [
                {
                  name: "build",
                  model: {
                    providerID: "anthropic",
                    modelID: "claude-haiku-4-5",
                  },
                },
              ],
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      fireEvent.change(await screen.findByLabelText("エージェント"), {
        target: { value: "build" },
      });
      fireEvent.change(await screen.findByLabelText("インテリジェンス"), {
        target: { value: "high" },
      });
      await typeAndSend("なぜ失敗するのか");

      await waitFor(() => expect(streamMock.sendPrompt).toHaveBeenCalled());
      const opts = streamMock.sendPrompt.mock.calls[0][1];
      expect(opts.model).toBeUndefined();
      expect(opts.variant).toBe("high");
      expect(opts.agent).toBe("build");
    });

    it("restricts the candidates to image-capable models when an image is attached", async () => {
      const streamMock = useSessionStream();
      const view = render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();

      const image = new File(["img"], "shot.png", { type: "image/png" });
      const input = view.container.querySelector('input[type="file"]');
      fireEvent.change(input as HTMLInputElement, { target: { files: [image] } });
      expect(await screen.findByRole("img", { name: "shot.png" })).toBeTruthy();
      await typeAndSend("なぜ失敗するのか");

      // Haiku is cheaper but text-only, so the image-capable Opus wins.
      await waitFor(() =>
        expect(streamMock.sendPrompt).toHaveBeenCalledWith(
          "なぜ失敗するのか",
          expect.objectContaining({
            model: { providerID: "anthropic", modelID: "claude-opus-5" },
          }),
        ),
      );
    });

    it("aborts with an error and keeps the draft when nothing can be selected", async () => {
      // Connected provider without any usable model: Auto stays selectable
      // (it is inserted unconditionally) but resolves to nothing.
      stubProviderFetch({
        all: [{ id: "anthropic", name: "Anthropic", models: {} }],
        connected: ["anthropic"],
        default: {},
      });
      const streamMock = useSessionStream();
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      await typeAndSend("なぜ失敗するのか");

      expect(
        await screen.findByText(
          "Auto で選択可能なモデルがありません。プロバイダ接続とモデル有効化を確認してください。",
        ),
      ).toBeTruthy();
      expect(streamMock.sendPrompt).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole("combobox", {
            name: "フォローアップを送信",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("なぜ失敗するのか");
    });

    it("passes the resolved model to a goal loop", async () => {
      // `progress` / `turnCount` / `maxTurns` must be present: GoalLoopPanel
      // spreads `loop.progress` as soon as this response lands, and without
      // them the late state update threw an unhandled TypeError.
      sendJson.mockResolvedValue({
        loop: {
          id: "loop1",
          status: "queued",
          turns: [],
          progress: [],
          turnCount: 0,
          maxTurns: 10,
        },
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      fireEvent.click(
        screen.getByRole("button", { name: "ループで継続実行" }),
      );
      fireEvent.change(
        screen.getByRole("combobox", { name: "フォローアップを送信" }),
        { target: { value: "なぜ失敗するのか" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "ループを開始" }));

      await waitFor(() =>
        expect(sendJson).toHaveBeenCalledWith(
          "POST",
          "/api/tasks/ws1/goal-loop",
          expect.objectContaining({
            model: {
              providerID: "anthropic",
              modelID: "claude-haiku-4-5",
            },
            variant: "minimal",
          }),
        ),
      );
    });

    it("does not treat the next chat message as a new loop after completion", async () => {
      const streamMock = useSessionStream();
      sendJson.mockResolvedValue({
        loop: {
          id: "loop1",
          status: "completed",
          progress: [],
          turnCount: 1,
          maxTurns: 10,
        },
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      fireEvent.click(screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL }));
      fireEvent.change(
        screen.getByRole("combobox", { name: "フォローアップを送信" }),
        { target: { value: "loop goal" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "ループを開始" }));

      await waitFor(() =>
        expect(sendJson).toHaveBeenCalledWith(
          "POST",
          "/api/tasks/ws1/goal-loop",
          expect.any(Object),
        ),
      );

      fireEvent.change(
        screen.getByRole("combobox", { name: "フォローアップを送信" }),
        { target: { value: "ordinary chat" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "送信" }));

      await waitFor(() => expect(streamMock.sendPrompt).toHaveBeenCalled());
      expect(
        sendJson.mock.calls.filter(([, path]) => path === "/api/tasks/ws1/goal-loop"),
      ).toHaveLength(1);
    });

    it("does not start the same goal loop twice while the request is pending", async () => {
      let resolveLoop: ((value: unknown) => void) | undefined;
      sendJson.mockImplementation((_method: string, path: string) => {
        if (path === "/api/tasks/ws1/goal-loop") {
          return new Promise((resolve) => { resolveLoop = resolve; });
        }
        return Promise.resolve(undefined);
      });

      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      fireEvent.click(screen.getByRole("button", { name: GOAL_LOOP_TOGGLE_LABEL }));
      fireEvent.change(
        screen.getAllByRole("combobox")[0]!,
        { target: { value: "duplicate guard" } },
      );
      const start = screen.getAllByRole("button").at(-1)!;
      fireEvent.click(start);
      fireEvent.click(start);

      await waitFor(() => {
        expect(
          sendJson.mock.calls.filter((call) => call[1] === "/api/tasks/ws1/goal-loop"),
        ).toHaveLength(1);
      });
      resolveLoop?.({
        loop: { id: "loop1", status: "queued", progress: [], turnCount: 0, maxTurns: 10 },
      });
    });

    it("forwards manual Intelligence to a fixed agent model in a goal loop", async () => {
      sendJson.mockResolvedValue({
        loop: {
          id: "loop1",
          status: "queued",
          turns: [],
          progress: [],
          turnCount: 0,
          maxTurns: 10,
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/opencode/provider")) {
            return Promise.resolve({
              ok: true,
              json: async () => providerPayload(),
            });
          }
          if (url.includes("/api/opencode/agent")) {
            return Promise.resolve({
              ok: true,
              json: async () => [
                {
                  name: "build",
                  model: {
                    providerID: "anthropic",
                    modelID: "claude-haiku-4-5",
                  },
                },
              ],
            });
          }
          return Promise.resolve({ ok: false });
        }),
      );
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      await selectAuto();
      fireEvent.change(await screen.findByLabelText("エージェント"), {
        target: { value: "build" },
      });
      fireEvent.change(await screen.findByLabelText("インテリジェンス"), {
        target: { value: "high" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "ループで継続実行" }),
      );
      fireEvent.change(
        screen.getByRole("combobox", { name: "フォローアップを送信" }),
        { target: { value: "なぜ失敗するのか" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "ループを開始" }));

      await waitFor(() =>
        expect(sendJson).toHaveBeenCalledWith(
          "POST",
          "/api/tasks/ws1/goal-loop",
          expect.objectContaining({ agent: "build", variant: "high" }),
        ),
      );
      const body = sendJson.mock.calls.find(
        (call) => call[1] === "/api/tasks/ws1/goal-loop",
      )?.[2];
      expect(body?.model).toBeUndefined();
    });

    describe("optimize mode", () => {
      const OPTIMIZE_LABEL = "Auto の最適化";

      it("replaces the effort selector while Auto is selected", async () => {
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        expect(screen.queryByLabelText(OPTIMIZE_LABEL)).toBeNull();

        await selectAuto();

        expect(screen.getByLabelText(OPTIMIZE_LABEL)).toBeTruthy();
        expect(screen.queryByLabelText("インテリジェンス")).toBeNull();
      });

      it("hydrates the stored mode", async () => {
        localStorage.setItem("webui:auto-optimize", "balanced");
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();

        expect(
          (screen.getByLabelText(OPTIMIZE_LABEL) as HTMLButtonElement).value,
        ).toBe("balanced");
      });

      async function pickMode(mode: string, label: string) {
        fireEvent.click(screen.getByLabelText(OPTIMIZE_LABEL));
        fireEvent.click(await screen.findByRole("option", { name: label }));
        await waitFor(() =>
          expect(
            (screen.getByLabelText(OPTIMIZE_LABEL) as HTMLButtonElement).value,
          ).toBe(mode),
        );
      }

      it("persists a mode change locally", async () => {
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await pickMode("intelligence", "知能優先");

        expect(localStorage.getItem("webui:auto-optimize")).toBe(
          "intelligence",
        );
      });

      it("raises the effort for a light prompt under 知能優先", async () => {
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await pickMode("intelligence", "知能優先");
        await typeAndSend("なぜ失敗するのか");

        // The fixture has no mid-band model, so light still lands on the cheap
        // one — but the effort rises from minimal (cost) to low.
        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "なぜ失敗するのか",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-haiku-4-5",
              },
              variant: "low",
            }),
          ),
        );
      });

      it("routes a standard prompt to the strong model under 知能優先", async () => {
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await pickMode("intelligence", "知能優先");
        await typeAndSend("ログを追加して");

        // intelligence/standard prefers the premium band at a high effort,
        // where cost/standard would have stayed on the cheap model.
        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "ログを追加して",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-opus-5",
              },
              variant: "high",
            }),
          ),
        );
      });

      it("keeps a standard prompt on the cheap model under コスト優先", async () => {
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("ログを追加して");

        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "ログを追加して",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-haiku-4-5",
              },
              variant: "low",
            }),
          ),
        );
      });

      it("follows a mode change made in another tab", async () => {
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();

        await act(async () => {
          localStorage.setItem("webui:auto-optimize", "balanced");
          window.dispatchEvent(
            new StorageEvent("storage", { key: "webui:auto-optimize" }),
          );
        });

        expect(
          (screen.getByLabelText(OPTIMIZE_LABEL) as HTMLButtonElement).value,
        ).toBe("balanced");
      });
    });

    describe("context signals", () => {
      /** A long conversation bumps the tier one step (light → standard). */
      function longHistory(count: number) {
        return Array.from({ length: count }, (_unused, index) => ({
          info: {
            id: `h${index}`,
            role: index % 2 === 0 ? "user" : "assistant",
            time: { created: index + 1, completed: index + 1 },
          },
          parts: [
            {
              id: `h${index}-p`,
              messageID: `h${index}`,
              type: "text",
              text: "過去のやりとり",
            },
          ],
        }));
      }

      it("keeps the light tier just below the history threshold", async () => {
        useSessionStream.mockReturnValue({
          ...useSessionStream(),
          status: { type: "idle" },
          messages: longHistory(19),
        });
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "なぜ失敗するのか",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-haiku-4-5",
              },
              variant: "minimal",
            }),
          ),
        );
      });

      it("bumps the tier once the conversation is long", async () => {
        useSessionStream.mockReturnValue({
          ...useSessionStream(),
          status: { type: "idle" },
          messages: longHistory(20),
        });
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        // light → standard: the cheap model stays (no mid band in the
        // fixture) but the effort rises from minimal to low.
        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "なぜ失敗するのか",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-haiku-4-5",
              },
              variant: "low",
            }),
          ),
        );
      });

      it("bumps the tier when the previous turn failed", async () => {
        useSessionStream.mockReturnValue({
          ...useSessionStream(),
          status: { type: "idle" },
          sessionError: "boom",
        });
        const streamMock = useSessionStream();
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        // light → standard for the same reason as the long-history case.
        await waitFor(() =>
          expect(streamMock.sendPrompt).toHaveBeenCalledWith(
            "なぜ失敗するのか",
            expect.objectContaining({
              model: {
                providerID: "anthropic",
                modelID: "claude-haiku-4-5",
              },
              variant: "low",
            }),
          ),
        );
      });
    });

    describe("model name visibility", () => {
      it("shows no follow-up notice by default", async () => {
        localStorage.removeItem("webui:auto-show-model");
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        await waitFor(() =>
          expect(useSessionStream().sendPrompt).toHaveBeenCalled(),
        );
        expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();
        expect(screen.queryByText(/^Auto: /)).toBeNull();
      });

      it("shows the follow-up notice once enabled", async () => {
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        expect(await screen.findByLabelText(CLOSE_LABEL)).toBeTruthy();
      });

      it("reveals a suppressed notice when another tab turns the setting on", async () => {
        localStorage.removeItem("webui:auto-show-model");
        render(<TaskView taskId="ws1" />);
        await flushTaskLoad();
        await selectAuto();
        await typeAndSend("なぜ失敗するのか");

        await waitFor(() =>
          expect(useSessionStream().sendPrompt).toHaveBeenCalled(),
        );
        expect(screen.queryByLabelText(CLOSE_LABEL)).toBeNull();

        await act(async () => {
          localStorage.setItem("webui:auto-show-model", "1");
          window.dispatchEvent(
            new StorageEvent("storage", { key: "webui:auto-show-model" }),
          );
        });

        expect(screen.getByLabelText(CLOSE_LABEL)).toBeTruthy();
      });
    });

  });
});

describe("TaskView voice input", () => {
  let mockRecognition: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    _dispatch: (type: string, ...args: unknown[]) => void;
  };

  beforeEach(() => {
    taskStatus = "idle";
    taskResponseCosts = [0.1];
    slashCommands.length = 0;
    setVisible(true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
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
      status: { type: "idle" },
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
      sendCommand: vi.fn(),
    });
    getJson.mockResolvedValue({ task: task(0.1) });
    sendJson.mockResolvedValue(undefined);

    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    mockRecognition = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(handler);
        },
      ),
      removeEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          listeners.get(type)?.delete(handler);
        },
      ),
      _dispatch(type: string, ...args: unknown[]) {
        for (const handler of listeners.get(type) ?? []) {
          handler(...args);
        }
      },
    };
    function MockCtor() {
      return mockRecognition;
    }
    vi.stubGlobal("webkitSpeechRecognition", MockCtor);
    vi.stubGlobal("SpeechRecognition", undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the mic button when SpeechRecognition is supported", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    expect(await screen.findByRole("button", { name: "音声入力" })).toBeTruthy();
  });

  it("appends transcript to the input on stop", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    const micBtn = await screen.findByRole("button", { name: "音声入力" });

    // Start listening
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate final result
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "follow up text" }, isFinal: true }],
      }),
    );

    // Stop listening. stop() resolves on `end`.
    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
    await act(async () => {
      mockRecognition._dispatch("end");
      await Promise.resolve();
    });

    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("follow up text");
  });

  it("keeps the composer available while the session is working", async () => {
    taskStatus = "working";
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
      sendCommand: vi.fn(),
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    expect((micBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not change existing input when transcript is empty", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    // Set an existing input value first
    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "existing text" } });
    expect(textarea.value).toBe("existing text");

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate an empty transcript (regression: guard `if (!text) return;`)
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "" }, isFinal: true }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));
    await act(async () => {
      mockRecognition._dispatch("end");
      await Promise.resolve();
    });

    expect(textarea.value).toBe("existing text");
  });

  it("disables the mic button when no session is created yet (Important 5)", async () => {
    // Task has no sessionId yet — composer controls are disabled, so the mic
    // button must be disabled too even though the task itself is idle.
    getJson.mockImplementation(() =>
      Promise.resolve({ task: { ...task(0.1), sessionId: null } }),
    );
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    expect((micBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows NextAction button when idle, loaded, with messages and no attention", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.getByLabelText("次の指示を提案")).toBeTruthy();
    const deliveryMode = screen.getByRole("button", { name: "送信方式" });
    expect(deliveryMode.getAttribute("aria-haspopup")).toBe("listbox");
    fireEvent.click(deliveryMode);
    expect(screen.getByRole("option", { name: "キュー" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "割り込み" })).toBeTruthy();
  });

  it("does not show NextAction when working", async () => {
    taskStatus = "working";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "busy" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });

  it("does not show NextAction when no messages", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [],
      loaded: true,
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });

  it("does not show NextAction when attention is pending", async () => {
    taskStatus = "idle";
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      status: { type: "idle" },
      visibleMessages: [
        {
          info: { id: "m1", role: "user" },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hello" }],
        },
      ],
      loaded: true,
      permissions: [
        {
          id: "perm-1",
          version: "v1",
          sessionID: "sess1",
          permission: "bash",
          patterns: [],
          receivedAt: Date.now(),
        },
      ],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    expect(screen.queryByLabelText("次の指示を提案")).toBeNull();
  });

  it("shows a scroll-to-bottom button when scrolled up and scrolls to bottom on click", async () => {
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      loaded: true,
      messages: [
        {
          info: { id: "m1", role: "user", time: { created: Date.now() } },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
        },
        {
          info: { id: "m2", role: "assistant", time: { created: Date.now() } },
          parts: [{ id: "p2", messageID: "m2", type: "text", text: "hello" }],
        },
      ],
      visibleMessages: [],
      status: { type: "idle" },
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const scroller = screen.getByTestId("message-scroller") as HTMLDivElement;

    // At bottom: no button
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 520 });
    fireEvent.scroll(scroller);
    expect(screen.queryByLabelText("最新のメッセージへ")).toBeNull();

    // Scrolled up: button appears
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 100, writable: true });
    fireEvent.scroll(scroller);
    const button = screen.getByLabelText("最新のメッセージへ");
    expect(button).not.toBeNull();

    // The button must live outside the scroller. An absolutely positioned child
    // of an overflow container is laid out against the scrolled content box, so
    // it would drift with the content instead of staying pinned to the viewport.
    expect(scroller.contains(button)).toBe(false);
    const anchor = button.parentElement?.parentElement as HTMLElement;
    expect(anchor.className).toContain("relative");
    expect(anchor.contains(scroller)).toBe(true);

    // Click scrolls to bottom
    fireEvent.click(button);
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 1000,
      behavior: "smooth",
    });

    // After scroll to bottom, button is hidden
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 520 });
    fireEvent.scroll(scroller);
    expect(screen.queryByLabelText("最新のメッセージへ")).toBeNull();
  });

  it("shows a scroll-to-first-message button when scrolled down and scrolls to top on click", async () => {
    useSessionStream.mockReturnValue({
      ...useSessionStream(),
      loaded: true,
      messages: [
        {
          info: { id: "m1", role: "user", time: { created: Date.now() } },
          parts: [{ id: "p1", messageID: "m1", type: "text", text: "hi" }],
        },
        {
          info: { id: "m2", role: "assistant", time: { created: Date.now() } },
          parts: [{ id: "p2", messageID: "m2", type: "text", text: "hello" }],
        },
      ],
      visibleMessages: [],
      status: { type: "idle" },
      permissions: [],
      questions: [],
    });
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const scroller = screen.getByTestId("message-scroller") as HTMLDivElement;

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    fireEvent.scroll(scroller);
    expect(screen.queryByLabelText("最初のメッセージへ")).toBeNull();

    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 200, writable: true });
    fireEvent.scroll(scroller);
    const button = screen.getByLabelText("最初のメッセージへ");
    expect(button).not.toBeNull();
    expect(scroller.contains(button)).toBe(false);

    fireEvent.click(button);
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      behavior: "smooth",
    });

    expect(screen.queryByLabelText("最初のメッセージへ")).toBeNull();
  });

  it("surfaces session restore failures inline and prevents duplicate restores", async () => {
    const streamMock = useSessionStream();
    streamMock.revert = { messageId: "m1" };
    unrevertSession.mockRejectedValue(new Error("restore failed"));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const restore = screen.getByRole("button", { name: "復元" });
    fireEvent.click(restore);
    fireEvent.click(restore);

    expect(restore.getAttribute("aria-busy")).toBe("true");
    await screen.findByText("restore failed");
    expect(unrevertSession).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(restore.getAttribute("aria-busy")).toBe("false");
  });

  it("confirms task deletion inline and preserves the menu trigger on cancel", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    taskStatus = "merged";

    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const menuTrigger = screen.getByRole("button", { name: "メニューを開く" });
    menuTrigger.focus();
    fireEvent.click(menuTrigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "タスクを削除" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Task title");
    expect(dialog.textContent).toContain("フォルダは残ります");
    expect(document.activeElement).toBe(dialog.querySelector("button"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(menuTrigger);
    expect(sendJson).not.toHaveBeenCalledWith("DELETE", "/api/tasks/ws1");

    fireEvent.click(menuTrigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "タスクを削除" }));
    fireEvent.click((await screen.findByRole("alertdialog")).querySelector("button")!);

    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith("DELETE", "/api/tasks/ws1");
    });
  });

  describe("desktop notifications", () => {
    let requestPermission: ReturnType<typeof vi.fn>;
    let notificationCtor: ReturnType<typeof vi.fn>;
    let permission: NotificationPermission;
    let permissionRequest: ReturnType<typeof deferred<NotificationPermission>>;

    // jsdom's `document.hidden` doesn't derive from `visibilityState` the
    // way real browsers do (`setVisible` above only overrides
    // visibilityState), and the component reads `.hidden` directly — so
    // simulate hidden-ness by overriding both.
    function setHidden(hidden: boolean) {
      setVisible(!hidden);
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
    }

    beforeEach(() => {
      permission = "default";
      permissionRequest = deferred<NotificationPermission>();
      // Controlled by the test (not auto-resolving) so exactly one
      // request/resolve cycle happens — an always-resolving mock let the
      // permissionTick -> effect -> requestPermission cascade spin as fast
      // as the microtask queue allows while permission stayed "default".
      requestPermission = vi.fn(() => permissionRequest.promise);
      notificationCtor = vi.fn();
      (notificationCtor as unknown as { requestPermission: typeof requestPermission }).requestPermission =
        requestPermission;
      // Object.assign would evaluate a `get permission()` accessor once and
      // copy its *current* value as a static property — later reassigning
      // the outer `permission` variable would then have no effect.
      // defineProperty keeps it a live accessor.
      Object.defineProperty(notificationCtor, "permission", {
        configurable: true,
        get: () => permission,
      });
      vi.stubGlobal("Notification", notificationCtor);
      setHidden(true);
    });

    it("still notifies the rising attention edge once permission is granted after the async prompt resolves", async () => {
      // Regression: the effect used to advance its prev-state refs on every
      // run regardless of permission. Requesting permission is async, so a
      // state change that happened while permission was still "default"
      // got its rising edge consumed before the user ever answered the
      // browser prompt — the notification that should fire once granted
      // never did.
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        status: { type: "busy" },
      });
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(notificationCtor).not.toHaveBeenCalled();

      // The user answers the browser's permission prompt, and the task
      // finishes in the same tick.
      permission = "granted";
      useSessionStream.mockReturnValue({
        ...useSessionStream(),
        status: { type: "idle" },
      });
      await act(async () => {
        permissionRequest.resolve("granted");
        await permissionRequest.promise;
      });

      expect(notificationCtor).toHaveBeenCalled();
    });

    it("tracks visibilitychange without erroring, so a later state change is evaluated against fresh hidden-ness", async () => {
      setHidden(false);
      permission = "granted";
      render(<TaskView taskId="ws1" />);
      await flushTaskLoad();
      expect(notificationCtor).not.toHaveBeenCalled();

      setHidden(true);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // No attention/working transition happened, so still no notification —
      // this only proves the visibilitychange listener doesn't throw or loop.
      expect(notificationCtor).not.toHaveBeenCalled();
    });
  });
});
